import { Injectable } from '@angular/core';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3/files';
const ONEPROXY_FOLDER_NAME = 'OneProxy';
const JSON_MIME_TYPE = 'application/json';

interface DriveFileRecord {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

interface DriveFileListResponse {
  files?: DriveFileRecord[];
}

export interface OneProxyFolderResult {
  id: string;
  name: string;
  created: boolean;
}

export interface OneProxyIndexRecord {
  version: 1;
  items: Array<{
    id: string;
    name: string;
    tags: string[];
  }>;
}

export interface OneProxyIndexResult {
  fileId: string;
  created: boolean;
  data: OneProxyIndexRecord;
}

export interface DriveUploadResult {
  id: string;
  name: string;
}

export interface DriveAttachmentRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
}

export interface DriveItemMetrics {
  totalBytes: number;
  fileCount: number;
}

@Injectable({ providedIn: 'root' })
export class GoogleDriveService {
  async ensureOneProxyFolder(accessToken: string): Promise<OneProxyFolderResult> {
    const existingFolder = await this.findOneProxyFolder(accessToken);

    if (existingFolder) {
      return {
        id: existingFolder.id,
        name: existingFolder.name,
        created: false,
      };
    }

    const createdFolder = await this.createFolder(accessToken, ONEPROXY_FOLDER_NAME);
    return {
      id: createdFolder.id,
      name: createdFolder.name,
      created: true,
    };
  }

  async ensureItemsFolder(accessToken: string, oneProxyFolderId: string): Promise<OneProxyFolderResult> {
    const existingFolder = await this.findFolderByName(accessToken, oneProxyFolderId, 'items');

    if (existingFolder) {
      return {
        id: existingFolder.id,
        name: existingFolder.name,
        created: false,
      };
    }

    const createdFolder = await this.createFolder(accessToken, 'items', oneProxyFolderId);
    return {
      id: createdFolder.id,
      name: createdFolder.name,
      created: true,
    };
  }

  async ensureItemFolder(accessToken: string, itemsFolderId: string, itemId: string): Promise<OneProxyFolderResult> {
    const existingFolder = await this.findFolderByName(accessToken, itemsFolderId, itemId);

    if (existingFolder) {
      return {
        id: existingFolder.id,
        name: existingFolder.name,
        created: false,
      };
    }

    const createdFolder = await this.createFolder(accessToken, itemId, itemsFolderId);
    return {
      id: createdFolder.id,
      name: createdFolder.name,
      created: true,
    };
  }

  async getItemFolder(
    accessToken: string,
    itemsFolderId: string,
    itemId: string,
  ): Promise<OneProxyFolderResult | null> {
    const existingFolder = await this.findFolderByName(accessToken, itemsFolderId, itemId);

    if (!existingFolder) {
      return null;
    }

    return {
      id: existingFolder.id,
      name: existingFolder.name,
      created: false,
    };
  }

  async ensureIndexFile(
    accessToken: string,
    folderId: string,
  ): Promise<OneProxyIndexResult> {
    const existingFile = await this.findIndexFile(accessToken, folderId);

    if (existingFile) {
      const data = await this.getJsonFile<OneProxyIndexRecord>(accessToken, existingFile.id);
      this.validateIndexRecord(data);

      return {
        fileId: existingFile.id,
        created: false,
        data,
      };
    }

    const initialData: OneProxyIndexRecord = {
      version: 1,
      items: [],
    };

    const createdFile = await this.createJsonFile(accessToken, folderId, 'index.json', initialData);
    return {
      fileId: createdFile.id,
      created: true,
      data: initialData,
    };
  }

  async saveIndexFile(
    accessToken: string,
    fileId: string,
    data: OneProxyIndexRecord,
  ): Promise<void> {
    this.validateIndexRecord(data);

    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          ...this.buildHeaders(accessToken),
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      await this.parseJson(response);
    }
  }

  async deleteFile(accessToken: string, fileId: string): Promise<void> {
    const response = await fetch(`${DRIVE_API_BASE_URL}/${fileId}`, {
      method: 'DELETE',
      headers: this.buildHeaders(accessToken),
    });

    if (!response.ok) {
      await this.parseJson(response);
    }
  }

  async renameFile(accessToken: string, fileId: string, newName: string): Promise<void> {
    const response = await fetch(`${DRIVE_API_BASE_URL}/${fileId}`, {
      method: 'PATCH',
      headers: {
        ...this.buildHeaders(accessToken),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: newName,
      }),
    });

    if (!response.ok) {
      await this.parseJson(response);
    }
  }

  async uploadMainImage(
    accessToken: string,
    itemFolderId: string,
    file: File,
  ): Promise<DriveUploadResult> {
    const extension = this.getFileExtension(file.name);
    const targetName = extension ? `main.${extension}` : 'main';
    return this.uploadFile(accessToken, itemFolderId, file, targetName, file.type || 'application/octet-stream');
  }

  async replaceMainImage(
    accessToken: string,
    itemFolderId: string,
    file: File,
  ): Promise<DriveUploadResult> {
    await this.deleteFilesByNamePattern(accessToken, itemFolderId, /^main(?:\.|$)/i);
    return this.uploadMainImage(accessToken, itemFolderId, file);
  }

  async uploadPreviewImage(
    accessToken: string,
    itemFolderId: string,
    previewBlob: Blob,
  ): Promise<DriveUploadResult> {
    return this.uploadFile(accessToken, itemFolderId, previewBlob, 'preview.jpg', 'image/jpeg');
  }

  async replacePreviewImage(
    accessToken: string,
    itemFolderId: string,
    previewBlob: Blob,
  ): Promise<DriveUploadResult> {
    await this.deleteFilesByExactName(accessToken, itemFolderId, 'preview.jpg');
    return this.uploadPreviewImage(accessToken, itemFolderId, previewBlob);
  }

  async uploadAttachment(
    accessToken: string,
    itemFolderId: string,
    file: File,
  ): Promise<DriveUploadResult> {
    return this.uploadFile(
      accessToken,
      itemFolderId,
      file,
      file.name,
      file.type || 'application/octet-stream',
    );
  }

  async listItemAttachments(
    accessToken: string,
    itemsFolderId: string,
    itemId: string,
  ): Promise<DriveAttachmentRecord[]> {
    const itemFolder = await this.findFolderByName(accessToken, itemsFolderId, itemId);
    if (!itemFolder) {
      return [];
    }

    const files = await this.listFilesInFolder(accessToken, itemFolder.id);
    return files
      .filter((file) => !this.isSystemManagedFile(file.name))
      .map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: typeof file.size === 'string' ? Number(file.size) : null,
      }));
  }

  async getItemMetrics(
    accessToken: string,
    itemsFolderId: string,
    itemId: string,
  ): Promise<DriveItemMetrics> {
    const itemFolder = await this.findFolderByName(accessToken, itemsFolderId, itemId);
    if (!itemFolder) {
      return {
        totalBytes: 0,
        fileCount: 0,
      };
    }

    const files = await this.listFilesInFolder(accessToken, itemFolder.id);
    return {
      totalBytes: files.reduce((total, file) => total + Number(file.size ?? 0), 0),
      fileCount: files.length,
    };
  }

  async downloadPreviewBlob(
    accessToken: string,
    itemsFolderId: string,
    itemId: string,
  ): Promise<Blob | null> {
    const itemFolder = await this.findFolderByName(accessToken, itemsFolderId, itemId);
    if (!itemFolder) {
      return null;
    }

    const previewFile = await this.findFileByName(accessToken, itemFolder.id, 'preview.jpg');
    if (!previewFile) {
      return null;
    }

    const response = await fetch(`${DRIVE_API_BASE_URL}/${previewFile.id}?alt=media`, {
      headers: this.buildHeaders(accessToken),
    });

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const errorPayload = (await response.json()) as { error?: { message?: string } };
        detail = errorPayload.error?.message ?? detail;
      } catch {
        // Ignore JSON parsing errors for blob responses.
      }

      throw new Error(`Google Drive preview download failed: ${detail}`);
    }

    return response.blob();
  }

  private async findOneProxyFolder(accessToken: string): Promise<DriveFileRecord | null> {
    const params = new URLSearchParams({
      q: [
        `name = '${ONEPROXY_FOLDER_NAME}'`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id,name,mimeType)',
      pageSize: '1',
      spaces: 'drive',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    const data = await this.parseJson<DriveFileListResponse>(response);
    return data.files?.[0] ?? null;
  }

  private async findFolderByName(
    accessToken: string,
    parentId: string,
    folderName: string,
  ): Promise<DriveFileRecord | null> {
    const params = new URLSearchParams({
      q: [
        `'${parentId}' in parents`,
        `name = '${this.escapeQueryValue(folderName)}'`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id,name,mimeType)',
      pageSize: '1',
      spaces: 'drive',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    const data = await this.parseJson<DriveFileListResponse>(response);
    return data.files?.[0] ?? null;
  }

  private async findFileByName(
    accessToken: string,
    parentId: string,
    fileName: string,
  ): Promise<DriveFileRecord | null> {
    const params = new URLSearchParams({
      q: [
        `'${parentId}' in parents`,
        `name = '${this.escapeQueryValue(fileName)}'`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id,name,mimeType)',
      pageSize: '1',
      spaces: 'drive',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    const data = await this.parseJson<DriveFileListResponse>(response);
    return data.files?.[0] ?? null;
  }

  private async listFilesInFolder(
    accessToken: string,
    parentId: string,
  ): Promise<DriveFileRecord[]> {
    const params = new URLSearchParams({
      q: [`'${parentId}' in parents`, 'trashed = false'].join(' and '),
      fields: 'files(id,name,mimeType,size)',
      pageSize: '100',
      spaces: 'drive',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    const data = await this.parseJson<DriveFileListResponse>(response);
    return data.files ?? [];
  }

  private async findIndexFile(
    accessToken: string,
    folderId: string,
  ): Promise<DriveFileRecord | null> {
    const params = new URLSearchParams({
      q: [
        `'${folderId}' in parents`,
        `name = 'index.json'`,
        `mimeType = '${JSON_MIME_TYPE}'`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id,name,mimeType)',
      pageSize: '1',
      spaces: 'drive',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    const data = await this.parseJson<DriveFileListResponse>(response);
    return data.files?.[0] ?? null;
  }

  private async createFolder(
    accessToken: string,
    name: string,
    parentId?: string,
  ): Promise<DriveFileRecord> {
    const response = await fetch(DRIVE_API_BASE_URL, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });

    return this.parseJson<DriveFileRecord>(response);
  }

  private async createJsonFile<T>(
    accessToken: string,
    folderId: string,
    name: string,
    data: T,
  ): Promise<DriveFileRecord> {
    const metadata = {
      name,
      mimeType: JSON_MIME_TYPE,
      parents: [folderId],
    };

    const boundary = 'oneproxy-boundary';
    const bodyParts = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(data),
      `--${boundary}--`,
    ];

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        ...this.buildHeaders(accessToken),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyParts.join('\r\n'),
    });

    return this.parseJson<DriveFileRecord>(response);
  }

  private async getJsonFile<T>(accessToken: string, fileId: string): Promise<T> {
    const params = new URLSearchParams({
      alt: 'media',
    });

    const response = await fetch(`${DRIVE_API_BASE_URL}/${fileId}?${params.toString()}`, {
      headers: this.buildHeaders(accessToken),
    });

    return this.parseJson<T>(response);
  }

  private buildHeaders(accessToken: string): HeadersInit {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async parseJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;

      try {
        const errorPayload = (await response.json()) as {
          error?: { message?: string };
        };
        detail = errorPayload.error?.message ?? detail;
      } catch {
        // Ignore JSON parsing errors and fall back to status text.
      }

      throw new Error(`Google Drive request failed: ${detail}`);
    }

    return (await response.json()) as T;
  }

  private escapeQueryValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private getFileExtension(fileName: string): string {
    const extension = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
    return extension === fileName.toLowerCase() ? '' : extension;
  }

  private async deleteFilesByExactName(
    accessToken: string,
    folderId: string,
    fileName: string,
  ): Promise<void> {
    const files = await this.listFilesInFolder(accessToken, folderId);
    const matches = files.filter((file) => file.name === fileName);
    await Promise.all(matches.map((file) => this.deleteFile(accessToken, file.id)));
  }

  private async deleteFilesByNamePattern(
    accessToken: string,
    folderId: string,
    pattern: RegExp,
  ): Promise<void> {
    const files = await this.listFilesInFolder(accessToken, folderId);
    const matches = files.filter((file) => pattern.test(file.name));
    await Promise.all(matches.map((file) => this.deleteFile(accessToken, file.id)));
  }

  private async uploadFile(
    accessToken: string,
    folderId: string,
    file: Blob,
    targetName: string,
    mimeType: string,
  ): Promise<DriveUploadResult> {
    const boundary = 'oneproxy-file-boundary';
    const metadata = {
      name: targetName,
      mimeType,
      parents: [folderId],
    };

    const body = new Blob(
      [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        '\r\n',
        `--${boundary}\r\n`,
        `Content-Type: ${mimeType}\r\n\r\n`,
        file,
        '\r\n',
        `--${boundary}--`,
      ],
      {
        type: `multipart/related; boundary=${boundary}`,
      },
    );

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          ...this.buildHeaders(accessToken),
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    const uploaded = await this.parseJson<DriveFileRecord>(response);
    return {
      id: uploaded.id,
      name: uploaded.name,
    };
  }

  private isSystemManagedFile(fileName: string): boolean {
    return fileName === 'preview.jpg' || /^main(?:\.|$)/i.test(fileName);
  }

  private validateIndexRecord(value: unknown): asserts value is OneProxyIndexRecord {
    if (!value || typeof value !== 'object') {
      throw new Error('index.json is invalid: expected an object.');
    }

    const record = value as Partial<OneProxyIndexRecord>;
    if (record.version !== 1) {
      throw new Error('index.json is invalid: unsupported version.');
    }

    if (!Array.isArray(record.items)) {
      throw new Error('index.json is invalid: items must be an array.');
    }

    for (const item of record.items) {
      if (!item || typeof item !== 'object') {
        throw new Error('index.json is invalid: item entries must be objects.');
      }

      if (typeof item.id !== 'string' || item.id.trim().length === 0) {
        throw new Error('index.json is invalid: each item needs a non-empty id.');
      }

      if (typeof item.name !== 'string' || item.name.trim().length === 0) {
        throw new Error('index.json is invalid: each item needs a non-empty name.');
      }

      if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) {
        throw new Error('index.json is invalid: each item needs a string[] tags field.');
      }
    }
  }
}
