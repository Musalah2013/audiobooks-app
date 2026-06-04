import type { ClickUpConfig } from "./clickup-config";

export function buildClickUpCustomFields(
  audiobook: {
    title: string;
    subtitle: string | null;
    publisherName: string;
    author: string | null;
    narrator: string | null;
    isbn: string | null;
    pubYear: string | null;
    genre: string | null;
    classificationDecision: string;
    processingStatus: string;
    dossierStatus: string;
    trackCount: number;
    totalLengthSeconds: number;
    importancePoints: number;
    blurb: string | null;
    sourceDriveLink: string | null;
    price: number | null;
  },
  config: ClickUpConfig,
  extra: { appLink?: string; workbookUrl?: string; audioZipUrl?: string } = {},
): Array<{ id: string; value: unknown }> {
  const fields: Array<{ id: string; value: unknown }> = [];
  const f = config.fieldMappings;

  function push(id: string | undefined, value: unknown) {
    if (id) fields.push({ id, value });
  }

  push(f.audiobookTitle, audiobook.title);
  if (audiobook.subtitle) push(f.subtitle, audiobook.subtitle);
  push(f.publisher, audiobook.publisherName);
  if (audiobook.author) push(f.author, audiobook.author);
  if (audiobook.narrator) push(f.narrator, audiobook.narrator);
  if (audiobook.isbn) push(f.isbn, audiobook.isbn);
  if (audiobook.pubYear) push(f.pubYear, audiobook.pubYear);
  if (audiobook.genre) push(f.genre, audiobook.genre);
  if (audiobook.blurb) push(f.blurb, audiobook.blurb);
  push(f.classification, audiobook.classificationDecision);
  push(f.processingStatus, audiobook.processingStatus);
  push(f.dossierStatus, audiobook.dossierStatus);
  push(f.trackCount, audiobook.trackCount);
  push(f.totalLengthHours, Number((audiobook.totalLengthSeconds / 3600).toFixed(2)));
  push(f.importancePoints, audiobook.importancePoints);
  if (audiobook.sourceDriveLink) push(f.driveUrl, audiobook.sourceDriveLink);
  if (audiobook.price != null) push(f.sellingPrice, audiobook.price);

  // Description-content fields that can be mapped to custom fields
  if (extra.appLink && f.appLink) push(f.appLink, extra.appLink);
  if (extra.workbookUrl && f.workbookUrl) push(f.workbookUrl, extra.workbookUrl);
  if (extra.audioZipUrl && f.audioZipUrl) push(f.audioZipUrl, extra.audioZipUrl);

  return fields;
}

export function buildClickUpDescription(
  config: ClickUpConfig,
  extra: { appLink: string; workbookUrl: string; audioZipUrl: string; classification: string; coverStatus: string },
): string {
  const d = config.descriptionTemplate;
  const lines: string[] = [];
  if (d.includeAppLink) lines.push(`**App Link:** ${extra.appLink}`);
  if (d.includeWorkbookUrl) lines.push(`**Dossier Workbook:** ${extra.workbookUrl}`);
  if (d.includeAudioZipUrl) lines.push(`**Final Audio ZIP:** ${extra.audioZipUrl}`);
  if (d.includeClassification) lines.push(`**Classification:** ${extra.classification}`);
  if (d.includeCoverStatus) lines.push(`**Cover Status:** ${extra.coverStatus}`);
  return lines.join("\n");
}
