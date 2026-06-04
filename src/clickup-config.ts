export type {
  ClickUpConfig,
  ClickUpFieldMappings,
  ClickUpDescriptionTemplate,
} from "./api-contracts";
import type { ClickUpConfig, ClickUpFieldMappings } from "./api-contracts";

export const FIELD_MAPPING_LABELS: Record<keyof ClickUpFieldMappings, string> = {
  audiobookTitle: 'Audiobook Title',
  subtitle: 'Subtitle',
  publisher: 'Publisher',
  author: 'Author',
  narrator: 'Narrator',
  isbn: 'ISBN',
  pubYear: 'Publication Year',
  genre: 'Genre',
  blurb: 'Description / Blurb',
  classification: 'Classification',
  processingStatus: 'Processing Status',
  dossierStatus: 'Dossier Status',
  trackCount: 'Track Count',
  totalLengthHours: 'Total Length (hours)',
  importancePoints: 'Importance Points',
  driveUrl: 'Source Drive URL',
  sellingPrice: 'Selling Price',
  appLink: 'App Link (ops URL)',
  workbookUrl: 'Dossier Workbook URL',
  audioZipUrl: 'Final Audio ZIP URL',
};

export const DEFAULT_CLICKUP_CONFIG: ClickUpConfig = {
  listId: '901211916918',
  statusName: '',
  updateExistingTask: true,
  attachCover: false,
  fieldMappings: {
    audiobookTitle: '3b06c470-4681-43e4-9bfc-5215251a1e18',
    subtitle: 'ef34fe16-91a6-4d29-b114-a583cfcf5bc9',
    publisher: '08e8126e-7074-4b19-ade8-d4584b77f83b',
    author: '03c5ed00-c276-4fc3-82c0-17a1f472c7d9',
    narrator: '2d7c69c9-4320-4abe-99af-64290aee9913',
    isbn: '4ea54a1a-09d3-4081-ab5c-cad784b6fc3f',
    pubYear: '781fff96-4d33-4ea7-bb3a-56095a50f62d',
    genre: 'ae545081-abd5-4a3c-8500-0b43a8c2b121',
    blurb: 'fd6348fd-01df-417c-a369-d0f8a7c569fd',
    classification: '1df595f7-872e-48b6-8e03-025bab7a53ec',
    processingStatus: '67e9d45f-de13-4343-9c50-ce1ab4228d05',
    dossierStatus: 'ffb76ba9-ca1c-40bb-a297-eea2de15ed7f',
    trackCount: 'cdb92d22-53f1-4ea1-849e-62d9a0417603',
    totalLengthHours: 'aa5b2014-a6c0-44dd-ada1-0d2b07765f48',
    importancePoints: '6b5a2481-115d-44d9-becd-9a51610003f7',
    driveUrl: 'd8a3e948-0490-46c2-a577-33fe749910d2',
    sellingPrice: 'cc109522-2a0b-42d5-b352-f32dbf51b820',
    appLink: '',
    workbookUrl: '',
    audioZipUrl: '',
  },
  descriptionTemplate: {
    includeAppLink: true,
    includeWorkbookUrl: true,
    includeAudioZipUrl: true,
    includeClassification: true,
    includeCoverStatus: true,
  },
};

export function mergeClickUpConfig(stored: Partial<ClickUpConfig> | null): ClickUpConfig {
  if (!stored) return DEFAULT_CLICKUP_CONFIG;
  return {
    listId: stored.listId ?? DEFAULT_CLICKUP_CONFIG.listId,
    statusName: stored.statusName ?? DEFAULT_CLICKUP_CONFIG.statusName,
    updateExistingTask: stored.updateExistingTask ?? DEFAULT_CLICKUP_CONFIG.updateExistingTask,
    attachCover: stored.attachCover ?? DEFAULT_CLICKUP_CONFIG.attachCover,
    fieldMappings: { ...DEFAULT_CLICKUP_CONFIG.fieldMappings, ...stored.fieldMappings },
    descriptionTemplate: { ...DEFAULT_CLICKUP_CONFIG.descriptionTemplate, ...stored.descriptionTemplate },
  };
}
