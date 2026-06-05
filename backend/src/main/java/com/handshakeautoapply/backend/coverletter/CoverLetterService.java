package com.handshakeautoapply.backend.coverletter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Generates a tailored cover letter by combining the user's stored resume with a
 * scraped job description and calling OpenAI's Chat Completions API (ChatGPT).
 * Generation runs server-side so the API key and resume never reach the
 * browser/extension.
 *
 * Uses Spring's RestClient against https://api.openai.com/v1 directly — no vendor
 * SDK. The stable writing instructions + resume go in the system message; the
 * volatile job description is the user message (OpenAI applies prompt caching to
 * long, repeated prefixes automatically, so no explicit cache markers are needed).
 */
@Service
public class CoverLetterService {

    private static final Logger log = LoggerFactory.getLogger(CoverLetterService.class);

    // ChatGPT's flagship general model — strong at writing, broadly available.
    private static final String MODEL = "gpt-4o";
    private static final int MAX_TOKENS = 1200;
    private static final String OPENAI_BASE_URL = "https://api.openai.com/v1";

    private final ResumeResolver resumeResolver;
    private final RestClient client; // null when no API key is configured
    private final boolean configured;

    public CoverLetterService(ResumeResolver resumeResolver) {
        this.resumeResolver = resumeResolver;

        RestClient built = null;
        boolean ok = false;
        String key = System.getenv("OPENAI_API_KEY");
        if (key != null && !key.isBlank()) {
            built = RestClient.builder()
                .baseUrl(OPENAI_BASE_URL)
                .defaultHeader("Authorization", "Bearer " + key.trim())
                .build();
            ok = true;
            log.info("OpenAI client initialized — cover-letter generation enabled (model {}).", MODEL);
        } else {
            log.warn("OPENAI_API_KEY not set — cover-letter generation disabled. "
                + "Set it in the backend environment and restart to enable.");
        }
        this.client = built;
        this.configured = ok;
    }

    public CoverLetterResponse generate(CoverLetterRequest request) {
        if (!configured) {
            throw new IllegalStateException(
                "Cover-letter generation is not configured. Set OPENAI_API_KEY in the backend "
                    + "environment and restart the companion service.");
        }

        String resume = resumeResolver.resolve();
        if (resume == null || resume.isBlank()) {
            throw new IllegalStateException(
                "No resume on file. Upload a resume PDF on the Documents page (or paste your resume "
                    + "text in the extension's Resume panel) before generating a cover letter.");
        }

        String company = orUnknown(request.company(), "the company");
        String role = orUnknown(request.jobTitle(), "this role");

        Map<String, Object> body = Map.of(
            "model", MODEL,
            "max_tokens", MAX_TOKENS,
            "messages", List.of(
                Map.of("role", "system", "content", buildSystemPrompt(resume)),
                Map.of("role", "user", "content", buildUserMessage(role, company, request.jobDescription()))
            )
        );

        log.info("Generating cover letter for role='{}' at company='{}'.", role, company);

        JsonNode response;
        try {
            response = client.post()
                .uri("/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode.class);
        } catch (RestClientResponseException e) {
            // Surface OpenAI's own error message (e.g. invalid key, rate limit) so it
            // reaches the extension instead of an opaque 500.
            String detail = extractOpenAiError(e.getResponseBodyAsString());
            log.error("OpenAI request failed ({}): {}", e.getStatusCode(), detail);
            throw new IllegalStateException("OpenAI request failed: " + detail);
        }

        String letter = extractContent(response);
        if (letter.isBlank()) {
            throw new IllegalStateException("OpenAI returned an empty cover letter.");
        }

        log.info("Cover letter generated ({} chars).", letter.length());
        return new CoverLetterResponse(letter, MODEL, Instant.now().toString());
    }

    private static String extractContent(JsonNode response) {
        if (response == null) {
            return "";
        }
        JsonNode content = response.path("choices").path(0).path("message").path("content");
        return content.isMissingNode() ? "" : content.asText("").trim();
    }

    private static String extractOpenAiError(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return "no response body";
        }
        try {
            JsonNode node = new ObjectMapper().readTree(responseBody);
            String message = node.path("error").path("message").asText("");
            return message.isBlank() ? responseBody : message;
        } catch (Exception e) {
            return responseBody;
        }
    }

    private static String orUnknown(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private static String buildSystemPrompt(String resume) {
        return """
            You are an expert career writer who produces tailored, authentic cover letters.

            Write in a confident, specific, first-person voice. Follow these rules strictly:
            - 250-350 words, 3-4 short paragraphs.
            - Ground every claim in the candidate's actual resume below. Never invent
              employers, titles, degrees, dates, or skills the resume does not support.
            - Connect the candidate's real experience to the specific role and company.
            - Avoid clichés ("I am writing to express my interest", "team player",
              "hit the ground running") and generic filler.
            - Output ONLY the body of the letter. No date, no mailing address, no
              "Dear Hiring Manager" salutation unless natural, and no bracketed
              placeholders like [Your Name] or [Company Address].

            The candidate's resume:
            <resume>
            %s
            </resume>
            """.formatted(resume);
    }

    private static String buildUserMessage(String role, String company, String jobDescription) {
        String jd = (jobDescription == null || jobDescription.isBlank())
            ? "(No job description was captured from the page.)"
            : jobDescription.trim();
        return """
            Write a cover letter for the following position.

            Role: %s
            Company: %s

            Job description:
            <job_description>
            %s
            </job_description>
            """.formatted(role, company, jd);
    }
}
