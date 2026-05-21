"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronRight,
  Globe,
  Building2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type WizardStep = "upload" | "preview" | "duplicates" | "missing" | "confirm";

interface ParsedRow {
  _rowIndex: number;
  companyName: string;
  alternativeNames: string;
  postcode: string;
  website: string;
  email: string;
  installerId: string;
  inMcs: boolean;
  inNova: boolean;
  inTrustMark: boolean;
  missingWebsite: boolean;
  missingName: boolean;
  _raw: Record<string, string>;
}

interface DuplicateMatch {
  rowIndex: number;
  incomingName: string;
  incomingPostcode: string;
  existingId: number;
  existingName: string;
  existingPostcode: string | null;
  matchType: string;
}

interface CsvDuplicate {
  rowIndex: number;
  duplicateOfRowIndex: number;
  companyName: string;
  matchType: string;
}

interface LookupResult {
  companiesHouse: { companyName: string; companyNumber: string; address: string; status: string } | null;
  possibleWebsites: string[];
}

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "preview", label: "Preview" },
  { key: "duplicates", label: "Duplicates" },
  { key: "confirm", label: "Import" },
];

export function ImportWizard() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [allRows, setAllRows] = useState<ParsedRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [format, setFormat] = useState("");
  const [dbDuplicates, setDbDuplicates] = useState<DuplicateMatch[]>([]);
  const [csvDuplicates, setCsvDuplicates] = useState<CsvDuplicate[]>([]);
  const [skipRows, setSkipRows] = useState<Set<number>>(new Set());
  const [lookupResults, setLookupResults] = useState<Record<number, LookupResult>>({});
  const [lookingUp, setLookingUp] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; errorCount: number } | null>(null);
  const router = useRouter();

  // Step 1: Upload and parse
  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }
    setFile(f);
  }, []);

  const parseFile = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAllRows(data.allRows);
      setStats(data.stats);
      setFormat(data.format);
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Check duplicates
  const checkDuplicates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/import/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: allRows.map((r) => ({
            _rowIndex: r._rowIndex,
            companyName: r.companyName,
            postcode: r.postcode,
            installerId: r.installerId,
          })),
        }),
      });
      const data = await res.json();
      setDbDuplicates(data.dbDuplicates);
      setCsvDuplicates(data.csvDuplicates);
      setStep("duplicates");
    } catch {
      toast.error("Duplicate check failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Lookup missing data for a single row
  const lookupRow = async (row: ParsedRow) => {
    setLookingUp(row._rowIndex);
    try {
      const res = await fetch("/api/import/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: row.companyName, postcode: row.postcode }),
      });
      const data = await res.json();
      setLookupResults((prev) => ({ ...prev, [row._rowIndex]: data }));
    } catch {
      toast.error("Lookup failed");
    } finally {
      setLookingUp(null);
    }
  };

  // Apply lookup result to a row
  const applyWebsite = (rowIndex: number, website: string) => {
    setAllRows((prev) =>
      prev.map((r) =>
        r._rowIndex === rowIndex
          ? { ...r, website, missingWebsite: false, _raw: { ...r._raw, _appliedWebsite: website } }
          : r
      )
    );
    toast.success("Website applied");
  };

  const applyRegisteredName = (rowIndex: number, name: string) => {
    setAllRows((prev) =>
      prev.map((r) =>
        r._rowIndex === rowIndex
          ? { ...r, alternativeNames: r.alternativeNames ? `${r.alternativeNames}; ${name}` : name, _raw: { ...r._raw, _registeredName: name } }
          : r
      )
    );
    toast.success("Registered name added to alternative names");
  };

  // Toggle skip row
  const toggleSkip = (rowIndex: number) => {
    setSkipRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  // Step 5: Execute import
  const executeImport = async () => {
    setLoading(true);
    try {
      // Rebuild the CSV data with any applied changes, excluding skipped rows
      const rowsToImport = allRows.filter((r) => !skipRows.has(r._rowIndex));

      // Re-upload via the original import endpoint with the raw data
      // But first apply any website/name changes
      const processedRows = rowsToImport.map((r) => {
        const raw = { ...r._raw };
        if (raw._appliedWebsite) {
          // Set as primary website source
          if (format === "merged") {
            if (!raw["MCS_Website"]) raw["MCS_Website"] = raw._appliedWebsite;
          } else {
            if (!raw["Website"]) raw["Website"] = raw._appliedWebsite;
          }
          delete raw._appliedWebsite;
        }
        if (raw._registeredName) {
          raw["Alternative Names / Trading Names"] = raw["Alternative Names / Trading Names"]
            ? `${raw["Alternative Names / Trading Names"]}; ${raw._registeredName}`
            : raw._registeredName;
          delete raw._registeredName;
        }
        return raw;
      });

      // Convert back to CSV and upload
      if (processedRows.length === 0) {
        toast.error("No rows to import");
        return;
      }

      const headers = Object.keys(processedRows[0]).filter((h) => !h.startsWith("_"));
      const csvContent = [
        headers.join(","),
        ...processedRows.map((row) =>
          headers
            .map((h) => {
              const val = row[h] || "";
              return val.includes(",") || val.includes('"')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            })
            .join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv" });
      const formData = new FormData();
      formData.append("file", blob, "import.csv");

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setImportResult(data);
      setStep("confirm");
      toast.success(`Imported ${data.imported}, updated ${data.updated}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);
  const missingRows = allRows.filter((r) => r.missingWebsite && !skipRows.has(r._rowIndex));

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            {i > 0 && <ChevronRight className="h-3 w-3 mx-1 text-muted-foreground" />}
            <span
              className={`text-xs font-medium px-2 py-1 rounded-md ${
                i === currentStepIndex
                  ? "bg-primary text-white"
                  : i < currentStepIndex
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <Card
          className={`border-2 border-dashed transition-colors ${file ? "border-primary/30" : "border-muted-foreground/25"}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            {file ? (
              <>
                <FileSpreadsheet className="h-12 w-12 text-primary mb-4" />
                <p className="text-lg font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground mb-4">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <div className="flex gap-2">
                  <Button onClick={parseFile} disabled={loading}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Parse & Preview
                  </Button>
                  <Button variant="outline" onClick={() => setFile(null)}>
                    Clear
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">Drag & drop your CSV file here</p>
                <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
                <label className="cursor-pointer">
                  <span className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
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
      )}

      {/* Step 2: Preview */}
      {step === "preview" && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Data Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total rows</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Missing website</p>
                  <p className="text-2xl font-bold text-amber-500">{stats.missingWebsite}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Format</p>
                  <p className="text-lg font-medium capitalize">{format}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {stats.withMcs > 0 && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    MCS: {stats.withMcs}
                  </Badge>
                )}
                {stats.withNova > 0 && (
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                    Nova: {stats.withNova}
                  </Badge>
                )}
                {stats.withTrustMark > 0 && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    TrustMark: {stats.withTrustMark}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Preview table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Preview (first 20 rows)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[300px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-1.5 pr-2 font-medium">#</th>
                      <th className="text-left py-1.5 pr-2 font-medium">Company</th>
                      <th className="text-left py-1.5 pr-2 font-medium">Postcode</th>
                      <th className="text-left py-1.5 pr-2 font-medium">Website</th>
                      <th className="text-left py-1.5 pr-2 font-medium">Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.slice(0, 20).map((row) => (
                      <tr key={row._rowIndex} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 text-muted-foreground">{row._rowIndex + 1}</td>
                        <td className="py-1.5 pr-2 font-medium">{row.companyName}</td>
                        <td className="py-1.5 pr-2">{row.postcode}</td>
                        <td className="py-1.5 pr-2">
                          {row.website ? (
                            <span className="text-green-600">{row.website}</span>
                          ) : (
                            <span className="text-amber-500">Missing</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <div className="flex gap-0.5">
                            {row.inMcs && <Badge variant="outline" className="text-[8px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200">MCS</Badge>}
                            {row.inNova && <Badge variant="outline" className="text-[8px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200">Nova</Badge>}
                            {row.inTrustMark && <Badge variant="outline" className="text-[8px] px-1 py-0 bg-green-50 text-green-700 border-green-200">TM</Badge>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("upload")}>
              Back
            </Button>
            <Button onClick={checkDuplicates} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Check Duplicates
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {/* Step 3: Duplicates */}
      {step === "duplicates" && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {dbDuplicates.length + csvDuplicates.length > 0 ? (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                Duplicate Check
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {dbDuplicates.length === 0 && csvDuplicates.length === 0 ? (
                <p className="text-green-600">No duplicates found</p>
              ) : (
                <>
                  {csvDuplicates.length > 0 && (
                    <div>
                      <p className="font-medium mb-1">Duplicates within CSV ({csvDuplicates.length})</p>
                      <div className="max-h-[150px] overflow-y-auto space-y-1">
                        {csvDuplicates.map((d, i) => (
                          <div key={i} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs">
                            <span>
                              Row {d.rowIndex + 1}: <span className="font-medium">{d.companyName}</span> (duplicate of row {d.duplicateOfRowIndex + 1})
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSkip(d.rowIndex)}
                              className="h-6 text-[10px]"
                            >
                              {skipRows.has(d.rowIndex) ? "Include" : "Skip"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {dbDuplicates.length > 0 && (
                    <div>
                      <p className="font-medium mb-1">Already in database ({new Set(dbDuplicates.map((d) => d.rowIndex)).size} rows)</p>
                      <p className="text-xs text-muted-foreground mb-2">These will be updated (not duplicated) on import.</p>
                      <div className="max-h-[150px] overflow-y-auto space-y-1">
                        {dbDuplicates.slice(0, 20).map((d, i) => (
                          <div key={i} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs">
                            <span>
                              Row {d.rowIndex + 1}: <span className="font-medium">{d.incomingName}</span>
                              <span className="text-muted-foreground"> matches </span>
                              <span className="font-medium">{d.existingName}</span>
                              <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1">{d.matchType}</Badge>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSkip(d.rowIndex)}
                              className="h-6 text-[10px]"
                            >
                              {skipRows.has(d.rowIndex) ? "Include" : "Skip"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {skipRows.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  {skipRows.size} row(s) will be skipped
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("preview")}>
              Back
            </Button>
            <Button onClick={executeImport} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Import {allRows.length - skipRows.size} Installers
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {/* Step 4: Confirm */}
      {step === "confirm" && importResult && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
            <h3 className="text-lg font-semibold">Import Complete</h3>
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-2xl font-bold">{importResult.imported}</p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{importResult.updated}</p>
                <p className="text-sm text-muted-foreground">Updated</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{importResult.errorCount}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Next: go to <a href="/cleanup" className="text-primary hover:underline font-medium">Data Cleanup</a> to match legal entities and find missing websites.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => router.push("/cleanup")}>
                Data Cleanup
              </Button>
              <Button variant="outline" onClick={() => router.push("/installers")}>
                View Installers
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setFile(null);
                  setAllRows([]);
                  setImportResult(null);
                  setSkipRows(new Set());
                  setLookupResults({});
                }}
              >
                Import Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
