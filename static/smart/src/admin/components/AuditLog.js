import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function AuditLog({ selectedProject }) {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const result = await invoke('getAuditLog', { limit: 100 });
      
      if (result.success && result.data) {
        setLogs(result.data);
      }
    } catch (error) {
      console.error('Błąd ładowania logów:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventTypeLabel = (eventType) => {
    const labels = {
      'incident_created': 'Utworzono alert',
      'incident_updated': 'Zaktualizowano alert',
      'priority_assigned': 'Przypisano priorytet',
      'team_assigned': 'Przypisano zespół',
      'teams_notification_sent': 'Wysłano powiadomienie Teams',
      'teams_notification_failed': 'Błąd powiadomienia Teams',
      'config_updated': 'Zaktualizowano konfigurację'
    };
    return labels[eventType] || eventType;
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('pl-PL');
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header flex-between">
        <div>
          <h3 className="section-title">Dziennik Audytu</h3>
          <p className="section-description">
            Historia wszystkich akcji wykonanych przez aplikację.
          </p>
        </div>
        <button
          className="btn btn-default"
          onClick={loadLogs}
        >
          🔄 Odśwież
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="message-box message-info">
          Brak wpisów w dzienniku audytu.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Data/Czas</th>
              <th>Typ Zdarzenia</th>
              <th>Użytkownik</th>
              <th>Szczegóły</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, index) => (
              <tr key={index}>
                <td>{formatDate(log.timestamp)}</td>
                <td>{getEventTypeLabel(log.eventType)}</td>
                <td>{log.user || '-'}</td>
                <td>
                  {log.details && (
                    <details className="audit-details">
                      <summary>Zobacz szczegóły</summary>
                      <pre className="audit-details-content">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AuditLog;
