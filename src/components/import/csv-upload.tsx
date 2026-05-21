"use client";

import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

interface ImportResult {
  imported: number;
  updated: number;
  total: number;
  errors: { row: number; issues: string[] }[];
  errorCount: number;
}

export function CsvUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }
    setFile(f);
    setResult(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }

      setResult(data);
      toast.success(
        `Imported ${data.imported} installers, updated ${data.updated}`
      );
    } catch {
      toast.error("Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          {file ? (
            <>
              <FileSpreadsheet className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              <div className="flex gap-2 mt-4">
                <Button onClick={handleUpload} disabled={isUploading}>
                  {isUploading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isUploading ? "Importing..." : "Import"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                  }}
                  disabled={isUploading}
                >
                  Clear
                </Button>
              </div>
            </>
          ) : (
            <>
              <Upload className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">
                Drag & drop your CSV file here
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse
              </p>
              <label className="cursor-pointer">
                <span className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted">
                  Browse Files
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Import Complete</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Imported</p>
                <p className="text-2xl font-bold">{result.imported}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Updated</p>
                <p className="text-2xl font-bold">{result.updated}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Rows</p>
                <p className="text-2xl font-bold">{result.total}</p>
              </div>
            </div>
            {result.errorCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {result.errorCount} rows had validation issues
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto rounded border p-3 text-xs">
                  {result.errors.map((err) => (
                    <div key={err.row} className="mb-1">
                      <span className="font-medium">Row {err.row}:</span>{" "}
                      {err.issues.join(", ")}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
