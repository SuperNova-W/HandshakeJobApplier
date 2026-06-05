import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Download,
  FileText,
  Files,
  FolderGit2,
  GraduationCap,
  ListChecks,
  type LucideIcon,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  deleteDocument,
  documentContentUrl,
  getScreeningPrefs,
  listDocuments,
  saveScreeningPrefs,
  uploadDocument
} from "../shared/backendApi";
import { BACKEND_BASE_URL, DEFAULT_SCREENING } from "../shared/constants";
import type { DocumentMeta, DocumentType, ScreeningPrefs } from "../shared/contracts";

interface FixedSlot {
  type: Exclude<DocumentType, "OTHER">;
  title: string;
  hint: string;
  icon: LucideIcon;
}

const FIXED_SLOTS: FixedSlot[] = [
  {
    type: "RESUME",
    title: "Resume",
    hint: "The resume PDF you attach to applications.",
    icon: FileText
  },
  {
    type: "COVER_LETTER",
    title: "Cover Letter",
    hint: "A general cover-letter file. You can also generate a tailored one per job from the extension popup.",
    icon: Mail
  },
  {
    type: "TRANSCRIPT",
    title: "Transcript",
    hint: "Your official or unofficial transcript.",
    icon: GraduationCap
  },
  {
    type: "GITHUB_PROJECT",
    title: "Coolest GitHub Project",
    hint: "A short writeup about your favorite GitHub project, with a link. Handshake apps ask for this surprisingly often. (An AI agent to auto-generate this from your repos is coming.)",
    icon: FolderGit2
  }
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

function Options() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [status, setStatus] = useState("Loading documents…");
  const [busy, setBusy] = useState<string | null>(null);
  const [otherLabel, setOtherLabel] = useState("");
  const otherInputRef = useRef<HTMLInputElement>(null);

  const [screening, setScreening] = useState<ScreeningPrefs>(DEFAULT_SCREENING);
  const [newLocation, setNewLocation] = useState("");
  const [screeningStatus, setScreeningStatus] = useState("");
  const [savingScreening, setSavingScreening] = useState(false);

  useEffect(() => {
    void refresh();
    void loadScreening();
  }, []);

  async function loadScreening() {
    try {
      setScreening(await getScreeningPrefs());
    } catch {
      /* leave defaults; the documents status surfaces backend errors */
    }
  }

  function addLocation() {
    const value = newLocation.trim();
    if (!value) return;
    setNewLocation("");
    if (screening.locations.some((l) => l.toLowerCase() === value.toLowerCase())) return;
    setScreening((s) => ({ ...s, locations: [...s.locations, value] }));
  }

  function removeLocation(loc: string) {
    setScreening((s) => ({ ...s, locations: s.locations.filter((l) => l !== loc) }));
  }

  async function handleSaveScreening() {
    setSavingScreening(true);
    setScreeningStatus("Saving…");
    try {
      setScreening(await saveScreeningPrefs(screening));
      setScreeningStatus("Saved.");
    } catch (error) {
      setScreeningStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingScreening(false);
    }
  }

  async function refresh() {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setStatus(`${docs.length} document${docs.length === 1 ? "" : "s"} on file.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Couldn't reach the backend (${error.message}). Is it running on ${BACKEND_BASE_URL}?`
          : "Couldn't load documents."
      );
    }
  }

  async function handleUpload(docType: DocumentType, file: File, label?: string) {
    setBusy(docType + (label ?? ""));
    setStatus(`Uploading ${file.name}…`);
    try {
      await uploadDocument(docType, file, label);
      setOtherLabel("");
      if (otherInputRef.current) otherInputRef.current.value = "";
      await refresh();
      setStatus(`Uploaded ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(doc: DocumentMeta) {
    setBusy(doc.id);
    try {
      await deleteDocument(doc.id);
      await refresh();
      setStatus(`Removed ${doc.filename}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(null);
    }
  }

  function onFixedFileChange(event: ChangeEvent<HTMLInputElement>, type: DocumentType) {
    const file = event.target.files?.[0];
    if (file) void handleUpload(type, file);
    event.target.value = "";
  }

  function onOtherFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleUpload("OTHER", file, otherLabel.trim() || undefined);
  }

  const otherDocs = documents.filter((d) => d.docType === "OTHER");

  return (
    <main className="page">
      <header className="page-header">
        <h1>Application Documents</h1>
        <p>
          Store the documents Handshake applications ask for. Files are kept locally in your
          companion backend ({BACKEND_BASE_URL}) and never leave your machine.
        </p>
      </header>

      <section className="grid">
        {FIXED_SLOTS.map((slot) => {
          const doc = documents.find((d) => d.docType === slot.type);
          const SlotIcon = slot.icon;
          return (
            <article className="card" key={slot.type}>
              <div className="card-head">
                <h2 className="card-title">
                  <SlotIcon size={17} aria-hidden="true" /> {slot.title}
                </h2>
                {doc ? <span className="badge badge-on">Uploaded</span> : <span className="badge">Empty</span>}
              </div>
              <p className="hint">{slot.hint}</p>

              {doc ? (
                <div className="file-row">
                  <div className="file-meta">
                    <strong>{doc.filename}</strong>
                    <span>
                      {formatSize(doc.sizeBytes)} · {formatDate(doc.uploadedAt)}
                    </span>
                  </div>
                  <div className="actions">
                    <a className="btn btn-ghost" href={documentContentUrl(doc.id)}>
                      <Download size={15} aria-hidden="true" /> Download
                    </a>
                    <label className="btn btn-secondary">
                      <RefreshCw size={15} aria-hidden="true" /> Replace
                      <input
                        type="file"
                        hidden
                        onChange={(e) => onFixedFileChange(e, slot.type)}
                      />
                    </label>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy === doc.id}
                      onClick={() => void handleDelete(doc)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label className="btn btn-primary upload-label">
                  <Upload size={16} aria-hidden="true" />
                  {busy === slot.type ? "Uploading…" : "Choose file"}
                  <input type="file" hidden onChange={(e) => onFixedFileChange(e, slot.type)} />
                </label>
              )}
            </article>
          );
        })}
      </section>

      <section className="card other-card">
        <div className="card-head">
          <h2 className="card-title">
            <Files size={17} aria-hidden="true" /> Other documents
          </h2>
          <span className="badge">{otherDocs.length}</span>
        </div>
        <p className="hint">
          Anything else an application requests (writing sample, portfolio, references…). Add a short
          label so you can tell them apart.
        </p>

        <div className="other-add">
          <input
            className="text-input"
            type="text"
            placeholder="Label (e.g. Writing sample)"
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
          />
          <label className="btn btn-primary">
            <Plus size={16} aria-hidden="true" /> Add document
            <input ref={otherInputRef} type="file" hidden onChange={onOtherFileChange} />
          </label>
        </div>

        {otherDocs.length > 0 && (
          <ul className="other-list">
            {otherDocs.map((doc) => (
              <li key={doc.id}>
                <div className="file-meta">
                  <strong>{doc.label ?? "(no label)"}</strong>
                  <span>
                    {doc.filename} · {formatSize(doc.sizeBytes)} · {formatDate(doc.uploadedAt)}
                  </span>
                </div>
                <div className="actions">
                  <a className="btn btn-ghost" href={documentContentUrl(doc.id)}>
                    <Download size={15} aria-hidden="true" /> Download
                  </a>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy === doc.id}
                    onClick={() => void handleDelete(doc)}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card screening-card">
        <div className="card-head">
          <h2 className="card-title">
            <ListChecks size={17} aria-hidden="true" /> Screening answers
          </h2>
        </div>
        <p className="hint">
          When a Handshake application has screening questions, the bot fills these in automatically.
          A job is still skipped if it asks something not covered here.
        </p>

        <div className="field">
          <label className="field-label">Are you authorized to work in the United States?</label>
          <div className="seg" role="group" aria-label="US work authorization">
            <button
              type="button"
              className={"seg-btn" + (screening.usWorkAuthorized ? " active" : "")}
              onClick={() => setScreening((s) => ({ ...s, usWorkAuthorized: true }))}
            >
              Yes
            </button>
            <button
              type="button"
              className={"seg-btn" + (!screening.usWorkAuthorized ? " active" : "")}
              onClick={() => setScreening((s) => ({ ...s, usWorkAuthorized: false }))}
            >
              No
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field-label">Locations you're in or willing to relocate to</label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={screening.relocateAnywhere}
              onChange={(e) => setScreening((s) => ({ ...s, relocateAnywhere: e.target.checked }))}
            />
            <span>Anywhere — answer “Yes” to every location question</span>
          </label>

          {!screening.relocateAnywhere && (
            <>
              <div className="other-add">
                <input
                  className="text-input"
                  type="text"
                  placeholder="Add a city or region (e.g. Miami)"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLocation();
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={addLocation}>
                  <Plus size={16} aria-hidden="true" /> Add
                </button>
              </div>
              {screening.locations.length > 0 ? (
                <div className="chips">
                  {screening.locations.map((loc) => (
                    <span className="chip" key={loc}>
                      {loc}
                      <button type="button" aria-label={`Remove ${loc}`} onClick={() => removeLocation(loc)}>
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="hint chips-empty">
                  No locations yet — location questions will be answered “No”.
                </p>
              )}
            </>
          )}
        </div>

        <div className="actions screening-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingScreening}
            onClick={() => void handleSaveScreening()}
          >
            <Save size={15} aria-hidden="true" /> {savingScreening ? "Saving…" : "Save answers"}
          </button>
          {screeningStatus && <span className="inline-status">{screeningStatus}</span>}
        </div>
      </section>

      <p className="status">{status}</p>
    </main>
  );
}

export default Options;
