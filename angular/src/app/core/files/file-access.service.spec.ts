import { TestBed } from '@angular/core/testing';
import { FileAccessService, MAX_ATTACHMENT_BYTES } from './file-access.service';
import { WorkspaceDbService } from '../persistence/workspace-db.service';

describe('FileAccessService', () => {
  let files: FileAccessService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FileAccessService, WorkspaceDbService] });
    files = TestBed.inject(FileAccessService);
  });

  afterEach(() => {
    TestBed.inject(WorkspaceDbService).ngOnDestroy();
  });

  it('reads a small attachment as the legacy data URL shape', async () => {
    const attachment = await files.readAttachment(new File(['fixture'], 'fixture.txt', { type: 'text/plain' }));

    expect(attachment.name).toBe('fixture.txt');
    expect(attachment.mime).toBe('text/plain');
    expect(attachment.size).toBe(7);
    expect(attachment.base64).toMatch(/^data:text\/plain;base64,/);
  });

  it('rejects attachments above the legacy 4 MiB limit', async () => {
    const large = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.bin');

    await expect(files.readAttachment(large)).rejects.toThrow('maximum 4 MiB');
  });

  it('uses the download fallback and revokes the object URL', async () => {
    vi.useFakeTimers();
    const url = 'blob:fixture';
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue(url);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await files.saveBlob(new Blob(['fixture']), '../backup.json', false);
    expect(result).toEqual({ saved: true, method: 'download' });
    expect(click).toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(revoke).toHaveBeenCalledWith(url);

    create.mockRestore();
    revoke.mockRestore();
    click.mockRestore();
    vi.useRealTimers();
  });

  it('sanitizes path separators and control characters in download names', async () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await files.saveBlob(new Blob(['fixture']), '../bad\u0000name?.json', false);

    expect(document.querySelector('a')?.download).toBe('.._bad_name_.json');
    vi.advanceTimersByTime(100);
    click.mockRestore();
    create.mockRestore();
    revoke.mockRestore();
    vi.useRealTimers();
  });

  it('returns cancellation instead of falling back when the picker is cancelled', async () => {
    const picker = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });

    await expect(files.saveBlob(new Blob(['fixture']), 'backup.json')).resolves.toEqual({
      saved: false,
      cancelled: true,
      method: 'picker',
    });
    delete (window as unknown as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('writes through the native picker when it is available', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const directory = { kind: 'directory', name: 'Workspace backups' } as unknown as FileSystemDirectoryHandle;
    const handle = { createWritable: async () => ({ write, close }) } as unknown as FileSystemFileHandle;
    const picker = vi.fn().mockResolvedValue(handle);
    const getDirectory = vi.spyOn(WorkspaceDbService.prototype, 'getBackupDirectoryHandle').mockResolvedValue(directory);
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });

    await expect(files.saveBlob(new Blob(['fixture']), 'backup.json')).resolves.toEqual({
      saved: true,
      method: 'picker',
    });
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'backup.json', startIn: directory });
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();

    getDirectory.mockRestore();
    delete (window as unknown as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});
