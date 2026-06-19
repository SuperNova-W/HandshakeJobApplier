package com.handshook.backend.otherdocs;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.handshook.backend.otherdocs.UserDocsContext.Source;
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
 * A retrieval-augmented agent that drafts the extra document an employer asks for
 * ("other required documents") when the auto-apply bot can't auto-fill it. It
 * retrieves the user's stored materials — resume, GitHub project writeup, and any
 * uploaded OTHER documents (via {@link UserDocsContext}) — and asks OpenAI to
 * produce the requested document grounded in those materials plus the job context.
 *
 * Mirrors {@code CoverLetterService}: generation runs server-side so the API key
 * and the user's documents never reach the browser, and it calls OpenAI's Chat
 * Completions API directly via Spring's RestClient (no vendor SDK).
 */
@Service
public class OtherDocsAgentService {

    private static final Logger log = LoggerFactory.getLogger(OtherDocsAgentService.class);

    private static final String MODEL = "gpt-4o";
    private static final int MAX_TOKENS = 1500;
    private static final String OPENAI_BASE_URL = "https://api.openai.com/v1";

    private final UserDocsContext userDocsContext;
    private final RestClient client; // null when no API key is configured
    private final boolean configured;

    public OtherDocsAgentService(UserDocsContext userDocsContext) {
        this.userDocsContext = userDocsContext;

        RestClient built = null;
        boolean ok = false;
        String key = System.getenv("OPENAI_API_KEY");
        if (key != null && !key.isBlank()) {
            built = RestClient.builder()
                .baseUrl(OPENAI_BASE_URL)
                .defaultHeader("Authorization", "Bearer " + key.trim())
                .build();
            ok = true;
            log.info("OpenAI client initialized — other-docs agent enabled (model {}).", MODEL);
        } else {
            log.warn("OPENAI_API_KEY not set — other-docs agent disabled. "
                + "Set it in the backend environment and restart to enable.");
        }
        this.client = built;
        this.configured = ok;
    }

    public OtherDocsResponse generate(OtherDocsRequest request) {
        if (!configured) {
            throw new IllegalStateException(
                "The document agent is not configured. Set OPENAI_API_KEY in the backend "
                    + "environment and restart the companion service.");
        }

        List<Source> sources = userDocsContext.gather();
        if (sources.isEmpty()) {
            log.warn("OTHER_DOCS_GENERATE blocked: no source documents on file");
            throw new IllegalStateException(
                "No documents on file to draft from. Upload your resume, GitHub project, or other "
                    + "documents on the Documents page before using the agent.");
        }

        String company = orUnknown(request.company(), "the company");
        String role = orUnknown(request.jobTitle(), "this role");
        int jdChars = request.jobDescription() == null ? 0 : request.jobDescription().length();
        int instructionChars = request.instructions() == null ? 0 : request.instructions().length();

        Map<String, Object> body = Map.of(
            "model", MODEL,
            "max_tokens", MAX_TOKENS,
            "messages", List.of(
                Map.of("role", "system", "content", buildSystemPrompt(sources)),
                Map.of("role", "user", "content",
                    buildUserMessage(role, company, request.jobDescription(), request.instructions()))
            )
        );

        log.info(
            "OTHER_DOCS_GENERATE start role='{}' company='{}' sources={} sourceLabels={} instructionsChars={} jobDescriptionChars={} model={} maxTokens={}",
            role,
            company,
            sources.size(),
            sources.stream().map(Source::label).toList(),
            instructionChars,
            jdChars,
            MODEL,
            MAX_TOKENS
        );

        JsonNode response;
        try {
            response = client.post()
                .uri("/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode.class);
        } catch (RestClientResponseException e) {
            String detail = extractOpenAiError(e.getResponseBodyAsString());
            log.error("OpenAI request failed ({}): {}", e.getStatusCode(), detail);
            throw new IllegalStateException("OpenAI request failed: " + detail);
        }

        String document = extractContent(response);
        if (document.isBlank()) {
            log.warn("OTHER_DOCS_GENERATE empty response role='{}' company='{}' rawResponse={}",
                role, company, response);
            throw new IllegalStateException("The agent returned an empty document.");
        }

        log.info("OTHER_DOCS_GENERATE complete role='{}' company='{}' chars={} usage={}",
            role, company, document.length(), response == null ? null : response.path("usage"));
        return new OtherDocsResponse(
            document, MODEL, Instant.now().toString(), sources.stream().map(Source::label).toList());
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

    private static String buildSystemPrompt(List<Source> sources) {
        StringBuilder kb = new StringBuilder();
        for (Source s : sources) {
            kb.append("<document name=\"").append(s.label()).append("\">\n")
                .append(s.text()).append("\n</document>\n\n");
        }
        return """
            You are an assistant that drafts the specific supplementary document a job
            employer is requesting from a candidate (for example: a statement of interest,
            a short project writeup, a list of relevant projects, a "why this company"
            note, or answers to a prompt). You write as the candidate, in first person.

            Follow these rules strictly:
            - Produce ONLY the document the employer asked for — no preamble, no
              explanation of what you're doing, no markdown headers unless the document
              type clearly needs them.
            - Ground every factual claim in the candidate's materials below. Never invent
              employers, titles, degrees, dates, projects, or skills the materials don't
              support. If the materials mention GitHub projects, draw on them specifically.
            - Tailor the content to the specific role and company in the request.
            - Keep a confident, specific, authentic voice and avoid generic filler and
              clichés. Do not include bracketed placeholders like [Your Name].

            The candidate's documents (their knowledge base):
            %s
            """.formatted(kb.toString().trim());
    }

    private static String buildUserMessage(
        String role, String company, String jobDescription, String instructions) {
        String jd = (jobDescription == null || jobDescription.isBlank())
            ? "(No job description was captured from the page.)"
            : jobDescription.trim();
        String ask = (instructions == null || instructions.isBlank())
            ? "(The employer did not give specific instructions — infer the most likely "
                + "document they want from the job description and provide it.)"
            : instructions.trim();
        return """
            Draft the document this employer is requesting.

            Role: %s
            Company: %s

            Employer's instructions for the document:
            <instructions>
            %s
            </instructions>

            Job description:
            <job_description>
            %s
            </job_description>
            """.formatted(role, company, ask, jd);
    }
}
