package com.handshakeautoapply.backend.content;

/** The user's stored resume text plus whether anything is on file. */
public record ResumeDto(String resumeText, boolean hasResume) {}
