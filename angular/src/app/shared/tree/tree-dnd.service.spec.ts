import { TreeDndService } from './tree-dnd.service';

describe('TreeDndService', () => {
  let service: TreeDndService;

  beforeEach(() => {
    service = new TreeDndService();
  });

  it('uses legacy mixed and reorder pointer zones', () => {
    const element = { getBoundingClientRect: () => ({ top: 10, height: 100 }) } as unknown as HTMLElement;
    expect(service.pointerPosition({ clientY: 20 }, element, true)).toBe('before');
    expect(service.pointerPosition({ clientY: 60 }, element, true)).toBe('inside');
    expect(service.pointerPosition({ clientY: 105 }, element, true)).toBe('after');
    expect(service.pointerPosition({ clientY: 59 }, element, false)).toBe('before');
    expect(service.pointerPosition({ clientY: 60 }, element, false)).toBe('after');
  });

  it('commits a typed drop and clears the active state', () => {
    service.begin('source', 'folder');
    service.setPreview('target', 'inside');
    expect(service.activeSource()).toEqual({ id: 'source', type: 'folder' });
    expect(service.commit('target', 'inside')).toEqual({
      sourceId: 'source',
      sourceType: 'folder',
      targetId: 'target',
      position: 'inside',
    });
    expect(service.activeSource()).toBeNull();
    expect(service.previewPosition()).toBeNull();
  });

  it('rejects self drops and supports keyboard cancellation', () => {
    service.begin('source', 'item');
    expect(service.commit('source', 'after')).toBeNull();
    service.begin('source', 'item');
    expect(service.startKeyboardMove()).toBe(true);
    expect(service.keyboardMoving()).toBe(true);
    service.cancel();
    expect(service.keyboardMoving()).toBe(false);
    expect(service.activeSource()).toBeNull();
  });
});
