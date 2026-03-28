import { CommonModule } from '@angular/common';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatToolbarModule } from '@angular/material/toolbar';
import { firstValueFrom } from 'rxjs';

import { DeleteConfirmDialogComponent } from './delete-confirm-dialog';
import { GoogleAuthService } from './google-auth.service';
import {
  DriveAttachmentRecord,
  DriveItemMetrics,
  GoogleDriveService,
  OneProxyIndexRecord,
} from './google-drive.service';

type AsyncStatus = 'idle' | 'checking' | 'ready' | 'error';

interface DraftAttachment {
  file: File;
  name: string;
  sizeLabel: string;
}

interface ExistingAttachment {
  id: string;
  name: string;
  sizeLabel: string;
  mimeType: string;
}

interface CreateProxyDraft {
  sourceFile: File | null;
  sourceFileName: string;
  imagePreviewUrl: string | null;
  id: string;
  name: string;
  tags: string[];
  tagInputValue: string;
  attachments: DraftAttachment[];
}

interface LibraryCardItem {
  id: string;
  name: string;
  tags: string[];
  imagePreviewUrl: string | null;
  isDeleting: boolean;
  storageLabel: string;
  fileCount: number;
  isLoadingMetrics: boolean;
}

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatSelectModule,
    MatToolbarModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  @ViewChild('proxyFileInput') private readonly proxyFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('attachmentFileInput')
  private readonly attachmentFileInput?: ElementRef<HTMLInputElement>;

  protected readonly tagSeparatorKeys = [ENTER, COMMA] as const;
  private filePickerMode: 'create' | 'replace' = 'create';

  private readonly googleAuthService = inject(GoogleAuthService);
  private readonly googleDriveService = inject(GoogleDriveService);
  private readonly dialog = inject(MatDialog);

  protected readonly searchQuery = signal('');
  protected readonly filterValue = signal('all');
  protected readonly googleConnectionState = this.googleAuthService.connectionState;
  protected readonly googleErrorMessage = this.googleAuthService.errorMessage;
  protected readonly grantedScopes = this.googleAuthService.grantedScopes;
  protected readonly isGoogleConfigured = this.googleAuthService.isConfigured;
  protected readonly hasAuthorizedBefore = this.googleAuthService.hasAuthorizedBefore;
  protected readonly isConnecting = computed(() => this.googleConnectionState() === 'connecting');
  protected readonly driveStatus = signal<AsyncStatus>('idle');
  protected readonly driveMessage = signal('Connect Google to validate Drive access.');
  protected readonly oneProxyFolderId = signal<string | null>(null);
  protected readonly itemsFolderId = signal<string | null>(null);
  protected readonly indexStatus = signal<AsyncStatus>('idle');
  protected readonly indexMessage = signal('Waiting for Drive validation.');
  protected readonly indexFileId = signal<string | null>(null);
  protected readonly indexRecord = signal<OneProxyIndexRecord | null>(null);
  protected readonly itemMetrics = signal<Record<string, DriveItemMetrics>>({});
  protected readonly isLibraryLoading = signal(false);
  protected readonly areMetricsLoading = signal(false);
  protected readonly isSavingProxy = signal(false);
  protected readonly saveMessage = signal('Choose an image to start creating a proxy.');
  protected readonly createFlowOpen = signal(false);
  protected readonly editorMode = signal<'create' | 'edit'>('create');
  protected readonly editingOriginalItemId = signal<string | null>(null);
  protected readonly createDraft = signal<CreateProxyDraft>(this.createEmptyDraft());
  protected readonly existingAttachments = signal<ExistingAttachment[]>([]);
  protected readonly deletedExistingAttachmentIds = signal<string[]>([]);
  protected readonly isLoadingExistingAttachments = signal(false);
  protected readonly itemPreviewUrls = signal<Record<string, string>>({});
  protected readonly deletingItemIds = signal<string[]>([]);

  protected readonly libraryItems = computed<LibraryCardItem[]>(() => {
    const previewUrls = this.itemPreviewUrls();
    const deletingItemIds = this.deletingItemIds();
    const metrics = this.itemMetrics();
    const areMetricsLoading = this.areMetricsLoading();

    return (this.indexRecord()?.items ?? []).map((item) => ({
      ...item,
      imagePreviewUrl: previewUrls[item.id] ?? null,
      isDeleting: deletingItemIds.includes(item.id),
      storageLabel: this.formatFileSize(metrics[item.id]?.totalBytes ?? 0),
      fileCount: metrics[item.id]?.fileCount ?? 0,
      isLoadingMetrics: areMetricsLoading && !metrics[item.id],
    }));
  });

  protected readonly indexItemCount = computed(() => this.libraryItems().length);
  protected readonly totalStorageBytes = computed(() =>
    Object.values(this.itemMetrics()).reduce((total, metrics) => total + metrics.totalBytes, 0),
  );
  protected readonly totalStorageLabel = computed(() =>
    this.formatFileSize(this.totalStorageBytes()),
  );
  protected readonly hasSelectedImage = computed(() => this.createDraft().sourceFile !== null);
  protected readonly canSaveProxy = computed(() => {
    const draft = this.createDraft();

    return (
      this.indexStatus() === 'ready' &&
      !this.isSavingProxy() &&
      draft.id.trim().length > 0 &&
      draft.name.trim().length > 0 &&
      (this.editorMode() === 'edit' || draft.sourceFile !== null)
    );
  });

  protected readonly filteredItems = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const filter = this.filterValue();

    return this.libraryItems().filter((item) => {
      const matchesQuery =
        query.length === 0 ||
        item.name.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query));

      const matchesFilter = filter === 'all' || item.tags.includes(filter);
      return matchesQuery && matchesFilter;
    });
  });

  protected readonly connectButtonLabel = computed(() => {
    if (this.isConnecting()) {
      return 'Connecting...';
    }

    if (this.googleConnectionState() === 'connected') {
      return 'Refresh Google Session';
    }

    return this.hasAuthorizedBefore() ? 'Reconnect Google' : 'Connect Google';
  });

  protected readonly editorTitle = computed(() =>
    this.editorMode() === 'create' ? 'Create Proxy' : 'Edit Proxy',
  );

  protected readonly editorSubtitle = computed(() =>
    this.editorMode() === 'create'
      ? 'Image selected first, then metadata review'
      : 'Update metadata, attachments, and optionally replace the stored image',
  );

  protected readonly saveButtonLabel = computed(() => {
    if (this.isSavingProxy()) {
      return this.editorMode() === 'create' ? 'Saving...' : 'Updating...';
    }

    return this.editorMode() === 'create' ? 'Save Proxy' : 'Save Changes';
  });

  protected readonly attachmentCountLabel = computed(() => {
    const count = this.createDraft().attachments.length;
    return count === 1 ? '1 attachment ready' : `${count} attachments ready`;
  });

  protected readonly existingAttachmentCountLabel = computed(() => {
    const count = this.existingAttachments().length;
    return count === 1 ? '1 file already in Drive' : `${count} files already in Drive`;
  });

  protected readonly hasConnectedSession = computed(
    () => this.indexStatus() === 'ready' || this.googleConnectionState() === 'connected',
  );

  protected setSearchQuery(value: string): void {
    this.searchQuery.set(value);
  }

  protected setFilterValue(value: string): void {
    this.filterValue.set(value);
  }

  protected openCreateProxyFlow(): void {
    this.filePickerMode = 'create';
    this.proxyFileInput?.nativeElement.click();
  }

  protected openEditProxyFlow(itemId: string): void {
    void this.openEditProxyFlowInternal(itemId);
  }

  private async openEditProxyFlowInternal(itemId: string): Promise<void> {
    const item = this.indexRecord()?.items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    const currentPreviewUrl = this.itemPreviewUrls()[item.id] ?? null;
    const previousPreviewUrl = this.createDraft().imagePreviewUrl;
    if (
      previousPreviewUrl &&
      previousPreviewUrl.startsWith('blob:') &&
      previousPreviewUrl !== currentPreviewUrl
    ) {
      URL.revokeObjectURL(previousPreviewUrl);
    }

    this.editorMode.set('edit');
    this.editingOriginalItemId.set(item.id);
    this.deletedExistingAttachmentIds.set([]);
    this.createDraft.set({
      sourceFile: null,
      sourceFileName: '',
      imagePreviewUrl: currentPreviewUrl,
      id: item.id,
      name: item.name,
      tags: [...item.tags],
      tagInputValue: '',
      attachments: [],
    });
    this.createFlowOpen.set(true);
    this.saveMessage.set('Update the fields, add any attachments, and optionally replace the image.');
    this.existingAttachments.set([]);

    const accessToken = this.googleAuthService.accessToken();
    const itemsFolderId = this.itemsFolderId();
    if (!accessToken || !itemsFolderId) {
      return;
    }

    this.isLoadingExistingAttachments.set(true);
    try {
      const attachments = await this.googleDriveService.listItemAttachments(accessToken, itemsFolderId, item.id);
      this.existingAttachments.set(
        attachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeLabel: this.formatPersistedAttachmentSize(attachment),
        })),
      );
    } catch {
      this.saveMessage.set('Edit mode opened, but existing attachments could not be loaded.');
    } finally {
      this.isLoadingExistingAttachments.set(false);
    }
  }

  protected selectReplacementImage(): void {
    this.filePickerMode = 'replace';
    this.proxyFileInput?.nativeElement.click();
  }

  protected openAttachmentPicker(): void {
    this.attachmentFileInput?.nativeElement.click();
  }

  protected onAttachmentFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    if (files.length === 0) {
      return;
    }

    const validationError = this.validateAttachmentSelection(files);
    if (validationError) {
      this.saveMessage.set(validationError);
      input.value = '';
      return;
    }

    const nextAttachments = files.map((file) => ({
      file,
      name: file.name,
      sizeLabel: this.formatFileSize(file.size),
    }));

    this.createDraft.update((draft) => ({
      ...draft,
      attachments: [...draft.attachments, ...nextAttachments],
    }));
    this.saveMessage.set(
      `Added ${files.length} attachment${files.length === 1 ? '' : 's'} to the draft.`,
    );
    input.value = '';
  }

  protected removeAttachment(fileName: string): void {
    this.createDraft.update((draft) => ({
      ...draft,
      attachments: draft.attachments.filter((attachment) => attachment.name !== fileName),
    }));
  }

  protected removeExistingAttachment(attachmentId: string): void {
    const attachment = this.existingAttachments().find((entry) => entry.id === attachmentId);
    if (!attachment) {
      return;
    }

    this.existingAttachments.update((attachments) =>
      attachments.filter((entry) => entry.id !== attachmentId),
    );
    this.deletedExistingAttachmentIds.update((ids) => [...ids, attachmentId]);
    this.saveMessage.set(`${attachment.name} will be deleted when you save changes.`);
  }

  protected onProxyFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    const previousPreviewUrl = this.createDraft().imagePreviewUrl;
    if (previousPreviewUrl && previousPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previousPreviewUrl);
    }

    if (this.filePickerMode === 'replace' && this.createFlowOpen()) {
      this.createDraft.update((draft) => ({
        ...draft,
        sourceFile: file,
        sourceFileName: file.name,
        imagePreviewUrl: nextPreviewUrl,
      }));
      this.saveMessage.set('Replacement image selected. Save changes to upload it.');
    } else {
      const parsed = this.parseFilename(file.name);
      this.editorMode.set('create');
      this.editingOriginalItemId.set(null);
      this.createDraft.set({
        sourceFile: file,
        sourceFileName: file.name,
        imagePreviewUrl: nextPreviewUrl,
        id: parsed.id,
        name: parsed.name,
        tags: parsed.tags,
        tagInputValue: '',
        attachments: [],
      });
      this.createFlowOpen.set(true);
      this.saveMessage.set('Review the parsed fields, attach any extra files, then save.');
    }

    input.value = '';
    this.filePickerMode = 'create';
  }

  protected setDraftId(value: string): void {
    this.createDraft.update((draft) => ({
      ...draft,
      id: this.normalizeItemId(value),
    }));
  }

  protected setDraftName(value: string): void {
    this.createDraft.update((draft) => ({
      ...draft,
      name: value,
    }));
  }

  protected setTagInputValue(value: string): void {
    this.createDraft.update((draft) => ({
      ...draft,
      tagInputValue: value,
    }));
  }

  protected addDraftTag(rawValue: string): void {
    const nextTag = rawValue.trim().toLowerCase();
    if (!nextTag) {
      this.clearTagInput();
      return;
    }

    this.createDraft.update((draft) => ({
      ...draft,
      tags: draft.tags.includes(nextTag) ? draft.tags : [...draft.tags, nextTag],
      tagInputValue: '',
    }));
  }

  protected removeDraftTag(tagToRemove: string): void {
    this.createDraft.update((draft) => ({
      ...draft,
      tags: draft.tags.filter((tag) => tag !== tagToRemove),
    }));
  }

  protected cancelCreateProxy(): void {
    this.resetCreateDraft();
    this.saveMessage.set('Choose an image to start creating a proxy.');
  }

  protected connectGoogle(): void {
    void this.connectGoogleAndDrive();
  }

  protected saveProxy(): void {
    void (this.editorMode() === 'create' ? this.createProxyInDrive() : this.updateProxyInDrive());
  }

  protected deleteProxy(itemId: string): void {
    void this.confirmAndDeleteProxy(itemId);
  }

  private async connectGoogleAndDrive(): Promise<void> {
    await this.googleAuthService.connect();

    const accessToken = this.googleAuthService.accessToken();
    if (!accessToken) {
      this.driveStatus.set('error');
      this.driveMessage.set('Google sign-in did not return an access token.');
      return;
    }

    this.driveStatus.set('checking');
    this.driveMessage.set('Checking Google Drive for the OneProxy folder...');
    this.isLibraryLoading.set(true);

    try {
      const folder = await this.googleDriveService.ensureOneProxyFolder(accessToken);
      this.oneProxyFolderId.set(folder.id);
      this.driveStatus.set('ready');
      this.driveMessage.set(
        folder.created
          ? 'Created /OneProxy in Google Drive.'
          : 'Found existing /OneProxy in Google Drive.',
      );

      const itemsFolder = await this.googleDriveService.ensureItemsFolder(accessToken, folder.id);
      this.itemsFolderId.set(itemsFolder.id);

      this.indexStatus.set('checking');
      this.indexMessage.set('Checking index.json in the OneProxy folder...');

      const indexFile = await this.googleDriveService.ensureIndexFile(accessToken, folder.id);
      this.indexFileId.set(indexFile.fileId);
      this.indexRecord.set(indexFile.data);
      this.indexStatus.set('ready');
      this.indexMessage.set(
        indexFile.created
          ? 'Created index.json in the OneProxy folder.'
          : 'Loaded existing index.json from the OneProxy folder.',
      );
      let previewsLoaded = true;
      try {
        await this.refreshPreviewImages(accessToken, itemsFolder.id, indexFile.data);
      } catch {
        previewsLoaded = false;
      }
      await this.refreshItemMetrics(accessToken, itemsFolder.id, indexFile.data);
      this.saveMessage.set(
        previewsLoaded
          ? 'Choose an image to start creating a proxy.'
          : 'Metadata loaded, but one or more previews could not be loaded yet.',
      );
    } catch (error) {
      this.oneProxyFolderId.set(null);
      this.itemsFolderId.set(null);
      this.driveStatus.set('error');
      this.indexFileId.set(null);
      this.indexRecord.set(null);
      this.indexStatus.set('error');
      this.indexMessage.set('index.json could not be validated.');
      this.itemMetrics.set({});
      this.driveMessage.set(
        error instanceof Error ? error.message : 'Google Drive validation failed.',
      );
      this.saveMessage.set('Cannot save proxies until Drive and index.json are ready.');
    } finally {
      this.isLibraryLoading.set(false);
    }
  }

  private async createProxyInDrive(): Promise<void> {
    const accessToken = this.googleAuthService.accessToken();
    const itemsFolderId = this.itemsFolderId();
    const indexFileId = this.indexFileId();
    const indexRecord = this.indexRecord();
    const draft = this.createDraft();

    if (!accessToken || !itemsFolderId || !indexFileId || !indexRecord) {
      this.saveMessage.set('Reconnect Google and load Drive metadata before saving.');
      return;
    }

    if (!draft.sourceFile) {
      this.saveMessage.set('Choose an image before saving.');
      return;
    }

    const itemId = this.normalizeItemId(draft.id);
    const itemName = draft.name.trim();
    const itemTags = Array.from(
      new Set([...draft.tags, draft.tagInputValue.trim().toLowerCase()].filter(Boolean)),
    );

    if (!itemId || !itemName) {
      this.saveMessage.set('The proxy needs both an id and a name.');
      return;
    }

    if (indexRecord.items.some((item) => item.id === itemId)) {
      this.saveMessage.set(`An item with id ${itemId} already exists.`);
      return;
    }

    this.isSavingProxy.set(true);
    this.saveMessage.set('Uploading image, attachments, creating Drive folders, and saving metadata...');

    try {
      const itemFolder = await this.googleDriveService.ensureItemFolder(
        accessToken,
        itemsFolderId,
        itemId,
      );
      await this.googleDriveService.uploadMainImage(accessToken, itemFolder.id, draft.sourceFile);
      const previewBlob = await this.createPreviewBlob(draft.sourceFile);
      await this.googleDriveService.uploadPreviewImage(accessToken, itemFolder.id, previewBlob);
      await this.uploadAttachments(accessToken, itemFolder.id, draft.attachments);

      const nextRecord: OneProxyIndexRecord = {
        ...indexRecord,
        items: [
          ...indexRecord.items,
          {
            id: itemId,
            name: itemName,
            tags: itemTags,
          },
        ],
      };

      await this.googleDriveService.saveIndexFile(accessToken, indexFileId, nextRecord);
      this.indexRecord.set(nextRecord);
      await this.refreshItemMetrics(accessToken, itemsFolderId, nextRecord);

      if (draft.imagePreviewUrl) {
        this.itemPreviewUrls.update((urls) => ({
          ...urls,
          [itemId]: draft.imagePreviewUrl as string,
        }));
      }

      this.resetCreateDraft(false);
      this.createFlowOpen.set(false);
      this.saveMessage.set('Proxy and attachments saved. The grid has been refreshed.');
    } catch (error) {
      this.saveMessage.set(
        error instanceof Error ? error.message : 'Failed to create the proxy.',
      );
    } finally {
      this.isSavingProxy.set(false);
    }
  }

  private async updateProxyInDrive(): Promise<void> {
    const accessToken = this.googleAuthService.accessToken();
    const itemsFolderId = this.itemsFolderId();
    const indexFileId = this.indexFileId();
    const indexRecord = this.indexRecord();
    const originalItemId = this.editingOriginalItemId();
    const draft = this.createDraft();

    if (!accessToken || !itemsFolderId || !indexFileId || !indexRecord || !originalItemId) {
      this.saveMessage.set('Reconnect Google and load Drive metadata before editing.');
      return;
    }

    const itemId = this.normalizeItemId(draft.id);
    const itemName = draft.name.trim();
    const itemTags = Array.from(
      new Set([...draft.tags, draft.tagInputValue.trim().toLowerCase()].filter(Boolean)),
    );

    if (!itemId || !itemName) {
      this.saveMessage.set('The proxy needs both an id and a name.');
      return;
    }

    if (itemId !== originalItemId && indexRecord.items.some((item) => item.id === itemId)) {
      this.saveMessage.set(`An item with id ${itemId} already exists.`);
      return;
    }

    this.isSavingProxy.set(true);
    this.saveMessage.set('Saving proxy changes and uploading attachments...');

    try {
      const itemFolder = await this.googleDriveService.getItemFolder(
        accessToken,
        itemsFolderId,
        originalItemId,
      );
      if (!itemFolder) {
        throw new Error(`Could not find the Drive folder for ${originalItemId}.`);
      }

      if (itemId !== originalItemId) {
        await this.googleDriveService.renameFile(accessToken, itemFolder.id, itemId);
      }

      if (draft.sourceFile) {
        await this.googleDriveService.replaceMainImage(accessToken, itemFolder.id, draft.sourceFile);
        const previewBlob = await this.createPreviewBlob(draft.sourceFile);
        await this.googleDriveService.replacePreviewImage(accessToken, itemFolder.id, previewBlob);
      }

      if (this.deletedExistingAttachmentIds().length > 0) {
        await Promise.all(
          this.deletedExistingAttachmentIds().map((attachmentId) =>
            this.googleDriveService.deleteFile(accessToken, attachmentId),
          ),
        );
      }

      if (draft.attachments.length > 0) {
        await this.uploadAttachments(accessToken, itemFolder.id, draft.attachments);
      }

      const nextRecord: OneProxyIndexRecord = {
        ...indexRecord,
        items: indexRecord.items.map((item) =>
          item.id === originalItemId
            ? {
                id: itemId,
                name: itemName,
                tags: itemTags,
              }
            : item,
        ),
      };

      await this.googleDriveService.saveIndexFile(accessToken, indexFileId, nextRecord);
      this.indexRecord.set(nextRecord);
      await this.refreshItemMetrics(accessToken, itemsFolderId, nextRecord);

      const previousUrl = this.itemPreviewUrls()[originalItemId] ?? null;
      this.itemPreviewUrls.update((urls) => {
        const nextUrls = { ...urls };
        if (originalItemId !== itemId) {
          delete nextUrls[originalItemId];
        }

        if (draft.sourceFile && draft.imagePreviewUrl) {
          nextUrls[itemId] = draft.imagePreviewUrl;
        } else if (previousUrl) {
          nextUrls[itemId] = previousUrl;
        }

        return nextUrls;
      });

      this.resetCreateDraft(false);
      this.createFlowOpen.set(false);
      this.editorMode.set('create');
      this.editingOriginalItemId.set(null);
      this.saveMessage.set('Proxy updated. New attachments were added and the grid has been refreshed.');
    } catch (error) {
      this.saveMessage.set(
        error instanceof Error ? error.message : 'Failed to update the proxy.',
      );
    } finally {
      this.isSavingProxy.set(false);
    }
  }

  private async confirmAndDeleteProxy(itemId: string): Promise<void> {
    const item = this.indexRecord()?.items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open(DeleteConfirmDialogComponent, {
          data: {
            itemId: item.id,
            itemName: item.name,
          },
          maxWidth: '480px',
        })
        .afterClosed(),
      { defaultValue: false },
    );

    if (!confirmed) {
      return;
    }

    const accessToken = this.googleAuthService.accessToken();
    const itemsFolderId = this.itemsFolderId();
    const indexFileId = this.indexFileId();
    const indexRecord = this.indexRecord();

    if (!accessToken || !itemsFolderId || !indexFileId || !indexRecord) {
      this.saveMessage.set('Reconnect Google and reload Drive metadata before deleting.');
      return;
    }

    this.deletingItemIds.update((ids) => [...ids, itemId]);
    this.saveMessage.set(`Deleting ${item.name} from Drive and index.json...`);

    try {
      const itemFolder = await this.googleDriveService.getItemFolder(accessToken, itemsFolderId, itemId);
      if (itemFolder) {
        await this.googleDriveService.deleteFile(accessToken, itemFolder.id);
      }

      const nextRecord: OneProxyIndexRecord = {
        ...indexRecord,
        items: indexRecord.items.filter((entry) => entry.id !== itemId),
      };

      await this.googleDriveService.saveIndexFile(accessToken, indexFileId, nextRecord);
      this.indexRecord.set(nextRecord);
      this.itemMetrics.update((metrics) => {
        const nextMetrics = { ...metrics };
        delete nextMetrics[itemId];
        return nextMetrics;
      });

      const previewUrl = this.itemPreviewUrls()[itemId];
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      this.itemPreviewUrls.update((urls) => {
        const nextUrls = { ...urls };
        delete nextUrls[itemId];
        return nextUrls;
      });

      this.saveMessage.set(`Deleted ${item.name}.`);
    } catch (error) {
      this.saveMessage.set(
        error instanceof Error ? error.message : `Failed to delete ${item.name}.`,
      );
    } finally {
      this.deletingItemIds.update((ids) => ids.filter((id) => id !== itemId));
    }
  }

  private validateAttachmentSelection(files: File[]): string | null {
    const existingNames = new Set(this.createDraft().attachments.map((attachment) => attachment.name.toLowerCase()));
    for (const attachment of this.existingAttachments()) {
      existingNames.add(attachment.name.toLowerCase());
    }
    const batchNames = new Set<string>();

    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (lowerName === 'preview.jpg' || /^main(?:\.|$)/i.test(file.name)) {
        return `Attachment name ${file.name} is reserved for system-managed files.`;
      }

      if (existingNames.has(lowerName) || batchNames.has(lowerName)) {
        return `Duplicate attachment name detected: ${file.name}. Rename it before uploading.`;
      }

      batchNames.add(lowerName);
    }

    return null;
  }

  private async uploadAttachments(
    accessToken: string,
    itemFolderId: string,
    attachments: DraftAttachment[],
  ): Promise<void> {
    await Promise.all(
      attachments.map((attachment) =>
        this.googleDriveService.uploadAttachment(accessToken, itemFolderId, attachment.file),
      ),
    );
  }

  private parseFilename(fileName: string): { id: string; name: string; tags: string[] } {
    const stem = fileName.replace(/\.[^.]+$/, '');
    const parts = stem
      .split(/[-_\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const tags: string[] = [];
    const codeParts = parts.slice(0, 2).map((part) => part.toUpperCase());
    let id = '';

    if (codeParts.length >= 2) {
      id = `${codeParts[0]}-${codeParts[1]}`;
    }

    const hasSpSuffix = parts.some((part, index) => index >= 2 && part.toLowerCase() === 'sp');

    if (hasSpSuffix) {
      tags.push('sp');
      id = id ? `${id}-sp` : 'sp';
    }

    const titleTokens = parts
      .slice(hasSpSuffix ? 3 : 2)
      .map((part) => part.replace(/\bsp\b/i, 'SP'))
      .filter(Boolean);

    const name = titleTokens.length > 0 ? titleTokens.join(' ') : id;

    return {
      id: this.normalizeItemId(id || stem),
      name,
      tags,
    };
  }

  private normalizeItemId(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private resetCreateDraft(revokePreview = true): void {
    const previewUrl = this.createDraft().imagePreviewUrl;
    if (revokePreview && previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    this.createDraft.set(this.createEmptyDraft());
    this.existingAttachments.set([]);
    this.deletedExistingAttachmentIds.set([]);
    this.isLoadingExistingAttachments.set(false);
    this.createFlowOpen.set(false);
    this.editorMode.set('create');
    this.editingOriginalItemId.set(null);
  }

  private createEmptyDraft(): CreateProxyDraft {
    return {
      sourceFile: null,
      sourceFileName: '',
      imagePreviewUrl: null,
      id: '',
      name: '',
      tags: [],
      tagInputValue: '',
      attachments: [],
    };
  }

  private clearTagInput(): void {
    this.createDraft.update((draft) => ({
      ...draft,
      tagInputValue: '',
    }));
  }

  private formatFileSize(byteCount: number): string {
    if (byteCount < 1024) {
      return `${byteCount} B`;
    }

    const kilobytes = byteCount / 1024;
    if (kilobytes < 1024) {
      return `${kilobytes.toFixed(1)} KB`;
    }

    return `${(kilobytes / 1024).toFixed(1)} MB`;
  }

  private formatPersistedAttachmentSize(attachment: DriveAttachmentRecord): string {
    return attachment.size === null ? attachment.mimeType || 'Unknown type' : this.formatFileSize(attachment.size);
  }

  private async createPreviewBlob(file: File): Promise<Blob> {
    const imageUrl = URL.createObjectURL(file);

    try {
      const image = await this.loadImage(imageUrl);
      const targetWidth = 320;
      const scale = targetWidth / image.width;
      const targetHeight = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Preview generation failed: canvas context was unavailable.');
      }

      context.drawImage(image, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.82);
      });

      if (!blob) {
        throw new Error('Preview generation failed: JPEG encoding returned no data.');
      }

      return blob;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  private loadImage(sourceUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('Preview generation failed: image could not be loaded.'));
      image.src = sourceUrl;
    });
  }

  private async refreshPreviewImages(
    accessToken: string,
    itemsFolderId: string,
    indexRecord: OneProxyIndexRecord,
  ): Promise<void> {
    const previousUrls = this.itemPreviewUrls();
    const nextEntries = await Promise.all(
      indexRecord.items.map(async (item) => {
        const existingUrl = previousUrls[item.id];
        if (existingUrl) {
          return [item.id, existingUrl] as const;
        }

        const blob = await this.googleDriveService.downloadPreviewBlob(
          accessToken,
          itemsFolderId,
          item.id,
        );
        return [item.id, blob ? URL.createObjectURL(blob) : null] as const;
      }),
    );

    const nextUrls = Object.fromEntries(
      nextEntries.filter((entry): entry is readonly [string, string] => entry[1] !== null),
    );

    for (const [itemId, url] of Object.entries(previousUrls)) {
      if (!nextUrls[itemId] && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }

    this.itemPreviewUrls.set(nextUrls);
  }

  private async refreshItemMetrics(
    accessToken: string,
    itemsFolderId: string,
    indexRecord: OneProxyIndexRecord,
  ): Promise<void> {
    this.areMetricsLoading.set(true);

    try {
      const metricsEntries = await Promise.all(
        indexRecord.items.map(async (item) => {
          const metrics = await this.googleDriveService.getItemMetrics(
            accessToken,
            itemsFolderId,
            item.id,
          );
          return [item.id, metrics] as const;
        }),
      );

      this.itemMetrics.set(Object.fromEntries(metricsEntries));
    } finally {
      this.areMetricsLoading.set(false);
    }
  }
}
