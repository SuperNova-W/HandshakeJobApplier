package com.handshakeautoapply.backend.coverletter;

import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import org.springframework.stereotype.Component;

/**
 * Renders the final cover-letter text to a simple, clean single-column PDF using
 * OpenPDF. No OpenAI dependency — this only lays out text the user already
 * reviewed, so it works even when generation is unconfigured. The output is what
 * the extension injects into Handshake's "Upload new" cover-letter file input.
 */
@Component
public class CoverLetterPdfRenderer {

    private static final float MARGIN = 72f; // 1 inch
    private static final float LEADING = 15f;
    private static final float PARA_SPACING = 10f;

    public byte[] render(String coverLetter) {
        String text = (coverLetter == null) ? "" : coverLetter.trim();
        if (text.isEmpty()) {
            throw new IllegalArgumentException("Cannot render an empty cover letter to PDF.");
        }

        Document document = new Document(PageSize.LETTER, MARGIN, MARGIN, MARGIN, MARGIN);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            PdfWriter.getInstance(document, out);
            document.open();
            Font body = FontFactory.getFont(FontFactory.HELVETICA, 11f, Font.NORMAL);

            // Blank lines separate paragraphs; single newlines inside a block are
            // collapsed to spaces so the body reflows cleanly at the page width.
            for (String block : text.split("\\n\\s*\\n")) {
                String paragraphText = block.trim().replaceAll("\\s*\\n\\s*", " ");
                if (paragraphText.isEmpty()) {
                    continue;
                }
                Paragraph paragraph = new Paragraph(paragraphText, body);
                paragraph.setLeading(LEADING);
                paragraph.setSpacingAfter(PARA_SPACING);
                document.add(paragraph);
            }
            document.close();
        } catch (DocumentException e) {
            throw new IllegalStateException("Failed to render cover letter to PDF: " + e.getMessage(), e);
        }
        return out.toByteArray();
    }
}
