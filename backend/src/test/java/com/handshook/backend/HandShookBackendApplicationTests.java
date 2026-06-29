package com.handshook.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:sqlite:target/handshook-test.db"
})
class HandShookBackendApplicationTests {

    @Test
    void contextLoads() {
    }
}
