import React, { useState } from 'react';

// SPA URL notifications must not reset the live iframe. On remount (resume,
// reconnect, explicit navigation), start at the latest path supplied by the pane.
export const PreviewFrame = React.forwardRef<HTMLIFrameElement, React.IframeHTMLAttributes<HTMLIFrameElement>>(
  ({ src, ...props }, ref) => {
    const [initialSrc] = useState(src);
    return <iframe {...props} src={initialSrc} ref={ref} />;
  },
);
PreviewFrame.displayName = 'PreviewFrame';
