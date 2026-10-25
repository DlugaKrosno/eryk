import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import DutySchedule from './admin/components/DutySchedule';

// Harmonogram dyżurów dla team leaderów: zmienia harmonogram swojego zespołu, pozostali go oglądają
function DutyScheduleTab({ showFlag, projectKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    // Odpowiedź dla poprzednio wybranego projektu nie może nadpisać aktualnej
    let cancelled = false;
    setLoading(true);
    invoke('getDutySchedule', { projectKey })
      .then(result => {
        if (cancelled) return;
        if (result.success) {
          setData(result);
        } else {
          showFlag('error', 'Błąd', result.error || 'Nie udało się załadować harmonogramu');
        }
      })
      .catch(() => { if (!cancelled) showFlag('error', 'Błąd', 'Nie udało się załadować harmonogramu'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectKey]);

  const handleSave = async (schedule) => {
    setSaving(true);
    try {
      const result = await invoke('saveDutySchedule', { projectKey, schedule });
      if (result.success) {
        setData(prev => ({ ...prev, schedule: result.schedule }));
        showFlag('success', 'Zapisano', 'Harmonogram dyżurów zapisany');
        return true;
      }
      showFlag('error', 'Błąd', result.error || 'Nie udało się zapisać harmonogramu');
      return false;
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zapisać harmonogramu');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!projectKey) {
    return <div className="message-box message-warning">Wybierz projekt (przycisk "Zmień projekt" na zakładce zgłaszania alertu).</div>;
  }
  if (loading || !data) {
    return <div className="loading-container"><div className="spinner"></div><p>Ładowanie harmonogramu...</p></div>;
  }

  const editableNames = data.teams.filter(t => data.editableTeamIds.includes(t.id)).map(t => t.name);

  return (
    <div>
      <div className="message-box message-info">
        {editableNames.length > 0
          ? `Możesz zmieniać harmonogram zespołów: ${editableNames.join(', ')}.`
          : 'Harmonogram jest tylko do odczytu. Zmienia go team leader zespołu lub administrator.'}
      </div>
      <DutySchedule
        teams={data.teams}
        schedule={data.schedule}
        users={data.people}
        saving={saving}
        onSave={handleSave}
        editableTeamIds={data.editableTeamIds}
      />
    </div>
  );
}

export default DutyScheduleTab;
