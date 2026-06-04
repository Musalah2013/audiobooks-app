import { AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';

interface Book {
  id: string;
  title: string;
  publisherName: string;
  processingStatus: string;
  dossierStatus: string;
}

export default function Processing() {
  const { data, loading, error } = useApi<{ audiobooks: Book[] }>('/api/dashboard');
  const { isArabic } = useLocale();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <span>{isArabic ? 'فشل التحميل' : 'Failed to load'}: {error}</span>
        </div>
      </div>
    );
  }

  const books = data?.audiobooks ?? [];
  const queued = books.filter(b => b.processingStatus === 'queued');
  const running = books.filter(b => b.processingStatus === 'running');
  const succeeded = books.filter(b => b.processingStatus === 'succeeded');
  const failed = books.filter(b => b.processingStatus === 'failed');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{isArabic ? 'قائمة المعالجة' : 'Processing queue'}</h1>
        <p className="text-gray-500 mt-1">{isArabic ? 'متابعة حالة معالجة الكتب الصوتية' : 'Monitor audiobook processing status'}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{isArabic ? 'بانتظار التنفيذ' : 'Queued'}</p>
              <p className="text-xl font-bold text-gray-900">{queued.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{isArabic ? 'قيد التشغيل' : 'Running'}</p>
              <p className="text-xl font-bold text-gray-900">{running.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{isArabic ? 'نجحت' : 'Succeeded'}</p>
              <p className="text-xl font-bold text-gray-900">{succeeded.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{isArabic ? 'فشلت' : 'Failed'}</p>
              <p className="text-xl font-bold text-gray-900">{failed.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isArabic ? 'المعالجة النشطة' : 'Active processing'}</h2>
        <div className="space-y-3">
          {[...queued, ...running].map((book) => (
            <div key={book.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-900">{book.title}</p>
                <p className="text-xs text-gray-500">{book.publisherName}</p>
              </div>
              <span className={`badge-${book.processingStatus === 'running' ? 'blue' : 'yellow'}`}>
                {book.processingStatus}
              </span>
            </div>
          ))}
          {queued.length === 0 && running.length === 0 && (
            <p className="text-gray-500">{isArabic ? 'لا توجد مهام معالجة نشطة.' : 'No active processing jobs.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
