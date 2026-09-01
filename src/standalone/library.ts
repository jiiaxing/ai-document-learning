import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeveloperLogger } from './logger';

export interface ReadingFileSummary {
    id: string;
    title: string;
    updatedAt: string;
}

interface ReadingFileRecord extends ReadingFileSummary {
    pdfPath: string;
    notesPath: string;
    importedAt: string;
}

interface ReadingLibraryFile {
    version: 1;
    documents: ReadingFileRecord[];
}

interface ImportReadingFileRequest {
    name?: unknown;
    dataBase64?: unknown;
}

export class ReadingLibraryError extends Error {
    constructor(message: string, readonly statusCode = 400) {
        super(message);
    }
}

export class ReadingLibrary {
    private readonly root: string;
    private readonly documentsDir: string;
    private readonly indexPath: string;

    constructor(root: string, private readonly logger: DeveloperLogger) {
        this.root = resolve(root);
        this.documentsDir = join(this.root, 'documents');
        this.indexPath = join(this.root, 'library.json');
        mkdirSync(this.documentsDir, { recursive: true });
        if (!existsSync(this.indexPath)) {
            this.writeIndex({ version: 1, documents: [] });
        }
    }

    list(): ReadingFileSummary[] {
        return this.readIndex().documents
            .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    importPdf(request: ImportReadingFileRequest): ReadingFileSummary {
        const title = safePdfTitle(request.name);
        const buffer = pdfBufferFromBase64(request.dataBase64);
        const now = new Date().toISOString();
        const id = `doc_${randomUUID()}`;
        const documentDir = join(this.documentsDir, id);
        mkdirSync(documentDir, { recursive: true });

        const record: ReadingFileRecord = {
            id,
            title,
            pdfPath: join('documents', id, 'source.pdf'),
            notesPath: join('documents', id, 'notes.json'),
            importedAt: now,
            updatedAt: now
        };

        writeFileSync(this.resolveLibraryPath(record.pdfPath), buffer);
        writeFileSync(this.resolveLibraryPath(record.notesPath), '{}\n', 'utf8');
        writeFileSync(join(documentDir, 'meta.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

        const index = this.readIndex();
        this.writeIndex({
            version: 1,
            documents: [record, ...index.documents.filter((entry) => entry.id !== id)]
        });
        this.logger.info('reading_file.imported', {
            id,
            title,
            bytes: buffer.byteLength
        });

        return toSummary(record);
    }

    pdfPathFor(id: string): string {
        const record = this.findRecord(id);
        const filePath = this.resolveLibraryPath(record.pdfPath);
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            throw new ReadingLibraryError('PDF file not found.', 404);
        }
        return filePath;
    }

    loadNotes(id: string): unknown {
        const record = this.findRecord(id);
        const filePath = this.resolveLibraryPath(record.notesPath);
        if (!existsSync(filePath)) {
            return {};
        }

        const parsed = JSON.parse(readFileSync(filePath, 'utf8') || '{}') as unknown;
        return isRecord(parsed) ? parsed : {};
    }

    saveNotes(id: string, notes: unknown): ReadingFileSummary {
        if (!isRecord(notes)) {
            throw new ReadingLibraryError('Notes must be a JSON object.');
        }

        const index = this.readIndex();
        const recordIndex = index.documents.findIndex((entry) => entry.id === id);
        if (recordIndex === -1) {
            throw new ReadingLibraryError('Reading file not found.', 404);
        }

        const now = new Date().toISOString();
        const record = {
            ...index.documents[recordIndex],
            updatedAt: now
        };
        index.documents[recordIndex] = record;

        writeFileSync(this.resolveLibraryPath(record.notesPath), `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
        writeFileSync(join(this.documentsDir, id, 'meta.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        this.writeIndex(index);
        this.logger.debug('reading_file.notes.saved', { id, title: record.title });
        return toSummary(record);
    }

    createPdfStream(id: string): ReturnType<typeof createReadStream> {
        return createReadStream(this.pdfPathFor(id));
    }

    private findRecord(id: string): ReadingFileRecord {
        if (!/^doc_[0-9a-f-]{36}$/i.test(id)) {
            throw new ReadingLibraryError('Reading file not found.', 404);
        }

        const record = this.readIndex().documents.find((entry) => entry.id === id);
        if (!record) {
            throw new ReadingLibraryError('Reading file not found.', 404);
        }
        return record;
    }

    private readIndex(): ReadingLibraryFile {
        if (!existsSync(this.indexPath)) {
            return { version: 1, documents: [] };
        }

        const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8') || '{}') as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.documents)) {
            return { version: 1, documents: [] };
        }

        return {
            version: 1,
            documents: parsed.documents
                .map(parseRecord)
                .filter((entry): entry is ReadingFileRecord => Boolean(entry))
        };
    }

    private writeIndex(index: ReadingLibraryFile): void {
        mkdirSync(this.root, { recursive: true });
        writeFileSync(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    }

    private resolveLibraryPath(relativePath: string): string {
        const filePath = resolve(this.root, relativePath);
        if (filePath !== this.root && filePath.startsWith(`${this.root}${sep}`)) {
            return filePath;
        }
        throw new ReadingLibraryError('Invalid library path.', 500);
    }
}

function parseRecord(value: unknown): ReadingFileRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = typeof value.id === 'string' ? value.id : '';
    const title = typeof value.title === 'string' ? value.title : '';
    const pdfPath = typeof value.pdfPath === 'string' ? value.pdfPath : '';
    const notesPath = typeof value.notesPath === 'string' ? value.notesPath : '';
    const importedAt = typeof value.importedAt === 'string' ? value.importedAt : '';
    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : importedAt;
    if (!id || !title || !pdfPath || !notesPath || !importedAt || !updatedAt) {
        return null;
    }

    return { id, title, pdfPath, notesPath, importedAt, updatedAt };
}

function toSummary(record: ReadingFileRecord): ReadingFileSummary {
    return {
        id: record.id,
        title: record.title,
        updatedAt: record.updatedAt
    };
}

function safePdfTitle(value: unknown): string {
    const title = basename(String(value ?? 'document.pdf'))
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .trim();
    if (!title) {
        return 'document.pdf';
    }
    return title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`;
}

function pdfBufferFromBase64(value: unknown): Buffer {
    const raw = String(value ?? '').trim();
    const base64 = raw.replace(/^data:application\/pdf;base64,/i, '');
    if (!base64) {
        throw new ReadingLibraryError('Missing PDF data.');
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength < 8 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new ReadingLibraryError('Imported file must be a PDF.');
    }
    return buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
