"use client";

// The browser's own print dialog saves a PDF; the print stylesheet does the layout.
export function PrintButton({ label = "Save as PDF or print" }: { label?: string }) {
  return <p className="no-print"><button type="button" className="btn secondary" onClick={() => window.print()}>{label}</button></p>;
}
