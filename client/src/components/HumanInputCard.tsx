import React, { useState, useEffect } from 'react';
import { CheckCircle2, Clock, Send, AlertCircle, Loader2 } from 'lucide-react';
import { AlphaHitlPayload } from '../types';
import { submitAlphaHitl } from '../api';

interface HumanInputCardProps {
  hitl: AlphaHitlPayload;
  onSubmitted?: () => void;
}

export const HumanInputCard: React.FC<HumanInputCardProps> = ({ hitl, onSubmitted }) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expiration countdown
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (hitl.expires_at) {
      const remaining = Math.max(0, Math.round((hitl.expires_at * 1000 - Date.now()) / 1000));
      return remaining;
    }
    if (hitl.timeout) {
      return hitl.timeout;
    }
    return null;
  });

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || submitted) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, submitted]);

  const isExpired = timeLeft !== null && timeLeft <= 0;

  const handleSubmit = async (submitValue?: any) => {
    if (submitting || submitted || isExpired) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload = submitValue !== undefined ? submitValue : formData;
      await submitAlphaHitl(hitl.callback_url, payload);
      setSubmitted(true);
      onSubmitted?.();
    } catch (err: any) {
      setError(err.message || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const widget = hitl.widget;
  const elements = widget?.elements || [];

  return (
    <div className="my-3 p-4 rounded-xl border border-sky-500/30 bg-sky-950/20 text-text-primary text-sm shadow-md animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-3">
        <div className="flex items-center gap-2 font-medium text-sky-400">
          <AlertCircle className="w-4 h-4 text-sky-400" />
          <span>{widget?.title || 'Human Input Required'}</span>
        </div>
        {timeLeft !== null && !submitted && (
          <div className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full ${isExpired ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-surface-elevated text-text-secondary border border-border/50'}`}>
            <Clock className="w-3 h-3" />
            <span>{isExpired ? 'Expired' : `${timeLeft}s remaining`}</span>
          </div>
        )}
      </div>

      {widget?.description && (
        <p className="text-text-secondary mb-3 text-xs leading-relaxed">{widget.description}</p>
      )}

      {submitted ? (
        <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Your response has been sent to the agent.</span>
        </div>
      ) : isExpired ? (
        <div className="text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-xs">
          This interaction has expired.
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-3"
        >
          {elements.map((el: any, idx: number) => {
            if (el.type === 'button_group') {
              const buttons = Array.isArray(el.button_group) ? el.button_group : [];
              return (
                <div key={idx} className="flex flex-wrap gap-2 pt-1">
                  {buttons.map((btn: any, bIdx: number) => {
                    const isPrimary = btn.style === 'primary' || bIdx === 0;
                    return (
                      <button
                        key={bIdx}
                        type="button"
                        disabled={submitting || isExpired}
                        onClick={() => handleSubmit(btn.value ?? btn.label)}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                          isPrimary
                            ? 'bg-sky-500 text-white hover:bg-sky-400'
                            : 'bg-surface-elevated border border-border/60 hover:bg-surface-hover text-text-primary'
                        }`}
                      >
                        {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                        {btn.label || btn.value}
                      </button>
                    );
                  })}
                </div>
              );
            }

            if (el.type === 'textarea') {
              return (
                <div key={idx} className="space-y-1">
                  {el.label && <label className="block text-xs font-medium text-text-secondary">{el.label}</label>}
                  <textarea
                    rows={3}
                    disabled={submitting || isExpired}
                    placeholder={el.placeholder || 'Enter your response...'}
                    value={formData[el.name || 'response'] || ''}
                    onChange={(e) => setFormData({ ...formData, [el.name || 'response']: e.target.value })}
                    className="w-full text-xs bg-surface-primary border border-border/60 rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
              );
            }

            if (el.type === 'input' || el.type === 'text') {
              return (
                <div key={idx} className="space-y-1">
                  {el.label && <label className="block text-xs font-medium text-text-secondary">{el.label}</label>}
                  <input
                    type="text"
                    disabled={submitting || isExpired}
                    placeholder={el.placeholder || ''}
                    value={formData[el.name || 'input'] || ''}
                    onChange={(e) => setFormData({ ...formData, [el.name || 'input']: e.target.value })}
                    className="w-full text-xs bg-surface-primary border border-border/60 rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
              );
            }

            return null;
          })}

          {/* Render default submit button if form has input fields but no button_group */}
          {elements.some((el: any) => el.type === 'input' || el.type === 'textarea' || el.type === 'text') &&
            !elements.some((el: any) => el.type === 'button_group') && (
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting || isExpired}
                  className="px-3.5 py-1.5 text-xs bg-sky-500 hover:bg-sky-400 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Submit Response
                </button>
              </div>
            )}

          {error && (
            <p className="text-xs text-rose-400 mt-2">{error}</p>
          )}
        </form>
      )}
    </div>
  );
};
