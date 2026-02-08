import { useEffect } from 'preact/hooks';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'info', onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const colorMap = {
    success: {
      bg: 'var(--md-sys-color-success-container)',
      text: 'var(--md-sys-color-on-success-container)',
    },
    error: {
      bg: 'var(--md-sys-color-error-container)',
      text: 'var(--md-sys-color-on-error-container)',
    },
    info: {
      bg: 'var(--md-sys-color-info-container)',
      text: 'var(--md-sys-color-on-info-container)',
    },
  };

  const c = colorMap[type];

  return (
    <div
      style={{
        position: 'fixed',
        top: '8px',
        left: '16px',
        right: '16px',
        padding: '12px 16px',
        backgroundColor: c.bg,
        color: c.text,
        borderRadius: 'var(--md-sys-shape-corner-medium)',
        font: 'var(--md-sys-typescale-body-medium)',
        boxShadow: 'var(--md-sys-elevation-2)',
        zIndex: 1000,
        animation: 'slideDown 0.2s ease-out',
      }}
    >
      {message}
    </div>
  );
}
