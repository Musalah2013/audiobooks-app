import { Link } from 'react-router-dom';
import { AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';

interface ProcessingRun {
  id: string;
  audiobookId: string;
  status: string;
  containerInstance: string | null;
  createdAt: string;
  updatedAt: string;
  resultJson: string | null;
  errorJson: string | null;
}

export default function ProcessingLogs() {
  const { data, loading, error } = useApi<{ runs: ProcessingRun[] }>('/api/processing/runs');
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
          <span>{isArabic ? 'فشل تحميل سجل المعالجة' : 'Failed to load processing logs'}: {error}</span>
        </div>
      </div>
    );
  }

  const runs = data?.runs ?? [];

  function statusIcon(status: string) {
    switch (status) {
      case 'succeeded':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
      case 'failed_blocking':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'running':
        return <Clock className="w-4 h-4 text-blue-600" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  }

  function statusBadge(status: string) {
    const classes: Record<string, string> = {
      succeeded: 'badge-green',
      failed: 'badge-red',
      failed_blocking: 'badge-red',
      failed_retryable: 'badge-yellow',
      running: 'badge-blue',
      queued: 'badge-yellow',
    };
    return <span className={classes[status] || 'badge-gray'}>{status}</span>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{isArabic ? 'سجل المعالجة' : 'Processing logs'}</h1>
        <p className="text-gray-500 mt-1">{isArabic ? 'سجل كل جولات معالجة الصوت' : 'History of all audio processing runs'}</p>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'الحالة' : 'Status'}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'معرف الجولة' : 'Run ID'}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'معرف الكتاب' : 'Book ID'}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'الحاوية' : 'Container'}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'تاريخ الإنشاء' : 'Created'}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{isArabic ? 'النتيجة' : 'Result'}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {statusIcon(run.status)}
                      {statusBadge(run.status)}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-900">{run.id.slice(0, 8)}</td>
                  <td className="py-3 px-4">
                    <Link
                      to={`/books/${run.audiobookId}`}
                      className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {run.audiobookId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-gray-500">{run.containerInstance ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-500">{new Date(run.createdAt).toLocaleString()}</td>
                  <td className="py-3 px-4">
                    {run.errorJson ? (
                      <span className="text-red-600 text-xs">{isArabic ? 'خطأ' : 'Error'}</span>
                    ) : run.resultJson ? (
                      <span className="text-green-600 text-xs">{isArabic ? 'نجاح' : 'Success'}</span>
                    ) : (
                      <span className="text-gray-400 text-xs">{isArabic ? 'معلّق' : 'Pending'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    {isArabic ? 'لا توجد جولات معالجة بعد.' : 'No processing runs yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
