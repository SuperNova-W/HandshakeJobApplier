package com.handshook.backend.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class GoogleProfileVerifierTests {

    private static final String CLIENT_ID = "handshook.apps.googleusercontent.com";

    @Test
    void verifiesAudienceBeforeLoadingProfile() {
        RestClient.Builder oauthBuilder = RestClient.builder().baseUrl("https://oauth2.googleapis.com");
        RestClient.Builder apiBuilder = RestClient.builder().baseUrl("https://www.googleapis.com");
        MockRestServiceServer oauthServer = MockRestServiceServer.bindTo(oauthBuilder).build();
        MockRestServiceServer apiServer = MockRestServiceServer.bindTo(apiBuilder).build();
        GoogleProfileVerifier verifier =
            new GoogleProfileVerifier(oauthBuilder.build(), apiBuilder.build(), CLIENT_ID);

        oauthServer.expect(requestTo(
            "https://oauth2.googleapis.com/tokeninfo?access_token=valid-token"
        )).andRespond(withSuccess(
            """
            {"aud":"handshook.apps.googleusercontent.com","expires_in":"3600"}
            """,
            MediaType.APPLICATION_JSON
        ));
        apiServer.expect(requestTo("https://www.googleapis.com/oauth2/v3/userinfo"))
            .andRespond(withSuccess(
                """
                {
                  "sub":"google-123",
                  "email":"person@example.com",
                  "email_verified":true,
                  "name":"Person",
                  "picture":"https://example.com/avatar.png"
                }
                """,
                MediaType.APPLICATION_JSON
            ));

        GoogleProfileVerifier.GoogleProfile profile = verifier.verify("valid-token");

        assertThat(profile.subject()).isEqualTo("google-123");
        assertThat(profile.email()).isEqualTo("person@example.com");
        oauthServer.verify();
        apiServer.verify();
    }

    @Test
    void rejectsTokenIssuedForAnotherClient() {
        RestClient.Builder oauthBuilder = RestClient.builder().baseUrl("https://oauth2.googleapis.com");
        RestClient.Builder apiBuilder = RestClient.builder().baseUrl("https://www.googleapis.com");
        MockRestServiceServer oauthServer = MockRestServiceServer.bindTo(oauthBuilder).build();
        GoogleProfileVerifier verifier =
            new GoogleProfileVerifier(oauthBuilder.build(), apiBuilder.build(), CLIENT_ID);

        oauthServer.expect(requestTo(
            "https://oauth2.googleapis.com/tokeninfo?access_token=wrong-client-token"
        )).andRespond(withSuccess(
            """
            {"aud":"another-app.apps.googleusercontent.com","expires_in":"3600"}
            """,
            MediaType.APPLICATION_JSON
        ));

        assertThatThrownBy(() -> verifier.verify("wrong-client-token"))
            .isInstanceOfSatisfying(UserAuthenticationException.class, ex ->
                assertThat(ex.status()).isEqualTo(HttpStatus.UNAUTHORIZED)
            );
        oauthServer.verify();
    }
}
