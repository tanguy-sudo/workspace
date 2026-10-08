import { TestBed } from '@angular/core/testing';
import { FeedbackService } from './feedback.service';

describe('FeedbackService', () => {
  let feedback: FeedbackService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FeedbackService] });
    feedback = TestBed.inject(FeedbackService);
  });

  it('creates and dismisses a typed toast', () => {
    const id = feedback.showToast('Enregistre', 'success', 10000);
    expect(feedback.toasts()).toEqual([{ id, message: 'Enregistre', kind: 'success' }]);

    feedback.dismissToast(id);
    expect(feedback.toasts()).toEqual([]);
  });

  it('resolves confirmation explicitly', async () => {
    const result = feedback.confirm({ title: 'Supprimer', message: 'Confirmer ?' });
    expect(feedback.modal()?.destructive).toBe(false);

    feedback.resolveModal(true);
    await expect(result).resolves.toBe(true);
    expect(feedback.modal()).toBeNull();
  });

  it('cancels a previous pending confirmation when a new one opens', async () => {
    const first = feedback.confirm({ title: 'A', message: 'A' });
    const second = feedback.confirm({ title: 'B', message: 'B' });

    await expect(first).resolves.toBe(false);
    feedback.resolveModal(false);
    await expect(second).resolves.toBe(false);
  });
});
