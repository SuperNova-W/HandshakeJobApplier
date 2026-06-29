package com.handshook.backend;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class HandShookBackendApplication {

    public static void main(String[] args) {
        ensureDatabaseDirectoryExists();
        SpringApplication.run(HandShookBackendApplication.class, args);
    }

    // SQLite creates the database file but not its parent directory, so make sure
    // the configured location exists before the datasource opens a connection.
    private static void ensureDatabaseDirectoryExists() {
        String dbPath = System.getenv().getOrDefault("HANDSHOOK_DB_PATH", "data/handshook.db");
        Path parent = Path.of(dbPath).toAbsolutePath().getParent();
        if (parent == null) {
            return;
        }
        try {
            Files.createDirectories(parent);
        } catch (IOException exception) {
            throw new UncheckedIOException(
                "Unable to create database directory " + parent, exception
            );
        }
    }
}
