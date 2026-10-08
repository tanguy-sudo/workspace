import { Injectable, inject } from '@angular/core';
import { WorkspaceDbService } from '../persistence/workspace-db.service';
import type { WorkspaceFile } from '../persistence/workspace-data';

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type FileSaveMethod = 'picker' | 'download';

export interface FileSaveResult {
  saved: boolean;
  method?: FileSaveMethod;
  cancelled?: boolean;
  error?: 'picker-failed';
}

interface SaveFileOptions {
  suggestedName?: string;
  startIn?: FileSystemDirectoryHandle;
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (options?: SaveFileOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

function pickerWindow(): FilePickerWindow | null {
  return typeof window === 'undefined' ? null : window as FilePickerWindow;
}

function safeFilename(value: string): string {
  const name = String(value || 'download')
    .replace(/[\\/\0\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim();
  return name && name !== '.' && name !== '..' ? name : 'download';
}

@Injectable({ providedIn: 'root' })
export class FileAccessService {
  private readonly db = inject(WorkspaceDbService);

  async readAttachment(file: File): Promise<WorkspaceFile> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('File is too large (maximum 4 MiB)');
    }

    const base64 = await this.readAsDataUrl(file);
    return {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      base64,
    };
  }

  async chooseBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
    const picker = pickerWindow()?.showDirectoryPicker;
    if (!picker) return null;
    try {
      const handle = await picker({ mode: 'readwrite' });
      await this.db.setBackupDirectoryHandle(handle);
      return handle;
    } catch (error) {
      if (this.isAbort(error)) return null;
      return null;
    }
  }

  canChooseBackupDirectory(): boolean {
    return !!pickerWindow()?.showDirectoryPicker;
  }

  async getBackupDirectoryLabel(): Promise<string> {
    const handle = await this.db.getBackupDirectoryHandle();
    return handle?.name || 'Téléchargements';
  }

  async clearBackupDirectory(): Promise<void> {
    await this.db.setBackupDirectoryHandle(null);
  }

  async saveBlob(
    blob: Blob,
    filename: string,
    preferPicker = true,
  ): Promise<FileSaveResult> {
    const name = safeFilename(filename);
    const picker = pickerWindow()?.showSaveFilePicker;
    if (preferPicker && picker) {
      try {
        const startIn = await this.db.getBackupDirectoryHandle();
        const handle = await picker({ suggestedName: name, ...(startIn ? { startIn } : {}) });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { saved: true, method: 'picker' };
      } catch (error) {
        if (this.isAbort(error)) return { saved: false, cancelled: true, method: 'picker' };
      }
    }

    return this.downloadBlob(blob, name);
  }

  createObjectUrl(blob: Blob): string {
    return URL.createObjectURL(blob);
  }

  revokeObjectUrl(url: string): void {
    URL.revokeObjectURL(url);
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File could not be read'));
      reader.onabort = () => reject(new Error('File read was cancelled'));
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('File could not be read'));
          return;
        }
        resolve(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  private downloadBlob(blob: Blob, filename: string): FileSaveResult {
    const url = this.createObjectUrl(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      this.revokeObjectUrl(url);
    }, 100);
    return { saved: true, method: 'download' };
  }

  private isAbort(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
  }
}
