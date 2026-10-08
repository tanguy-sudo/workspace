import { TestBed } from '@angular/core/testing';
import { TreeComponent } from './tree.component';
import type { TreeDropEvent } from './tree-dnd.service';

describe('TreeComponent', () => {
  const nodes = [
    {
      id: 'folder',
      nodeType: 'folder',
      name: 'Folder',
       children: [{ id: 'item', nodeType: 'document', title: 'Item' }],
    },
    { id: 'second', nodeType: 'item', title: 'Second' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TreeComponent] });
  });

  it('renders an accessible tree and nested group', () => {
    const fixture = TestBed.createComponent(TreeComponent);
    fixture.componentRef.setInput('nodes', nodes);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="tree"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('[role="treeitem"]')?.getAttribute('aria-level')).toBe('1');
    expect(fixture.nativeElement.querySelector('[role="treeitem"]')?.getAttribute('aria-setsize')).toBe('2');
    expect(fixture.nativeElement.querySelector('[data-id="folder"] .treeitem-kind')?.textContent).toContain('DIR');
    expect(fixture.nativeElement.querySelector('[role="group"]')).toBeNull();

    const folder = fixture.nativeElement.querySelector('[data-id="folder"]') as HTMLElement;
    folder.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="group"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-id="item"]')?.getAttribute('aria-level')).toBe('2');
    expect(fixture.nativeElement.querySelector('[data-id="item"] .treeitem-kind')?.textContent).toContain('DOC');
  });

  it('emits native drops without mutating input nodes', () => {
    const fixture = TestBed.createComponent(TreeComponent);
    fixture.componentRef.setInput('nodes', nodes);
    const events: TreeDropEvent[] = [];
    fixture.componentInstance.dropped.subscribe((event) => events.push(event));
    fixture.detectChanges();

    const source = fixture.nativeElement.querySelector('[data-id="second"]') as HTMLElement;
    const target = fixture.nativeElement.querySelector('[data-id="folder"]') as HTMLElement;
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    Object.defineProperty(target, 'getBoundingClientRect', { value: () => ({ top: 0, height: 100 }) });
    const dragOver = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragOver, 'clientY', { value: 50 });
    target.dispatchEvent(dragOver);
    target.dispatchEvent(new Event('drop', { bubbles: true }));

    expect(events).toEqual([{ sourceId: 'second', sourceType: 'item', targetId: 'folder', position: 'inside' }]);
    expect(nodes[0].children).toHaveLength(1);
  });

  it('supports keyboard pickup, target selection and inside placement', () => {
    const fixture = TestBed.createComponent(TreeComponent);
    fixture.componentRef.setInput('nodes', nodes);
    const events: TreeDropEvent[] = [];
    fixture.componentInstance.dropped.subscribe((event) => events.push(event));
    fixture.detectChanges();

    const source = fixture.nativeElement.querySelector('[data-id="second"]') as HTMLElement;
    source.dispatchEvent(new Event('focus'));
    const tree = fixture.nativeElement.querySelector('[role="tree"]') as HTMLElement;
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toEqual([{ sourceId: 'second', sourceType: 'item', targetId: 'folder', position: 'inside' }]);
  });
});
