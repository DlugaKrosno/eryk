import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { TRANSFERABLE_KEYS, validateImport } from './configImport';

// Eksport i import konfiguracji projektu (np. z development do produkcji, albo kopia zapasowa)
function ConfigTransfer({ showFlag, selectedProject }) {
  const [open, setOpen] = useState(false);
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const [errors, setErrors] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const result = await invoke('getProjectConfig', { projectKey: selectedProject });
      if (!result.success || !result.isAdmin) {
        showFlag('error', 'Błąd', 'Eksport wymaga uprawnień administratora');
        return;
      }
      const picked = {};
      TRANSFERABLE_KEYS.forEach(key => { if (result.config[key] !== undefined) picked[key] = result.config[key]; });
      setExported(JSON.stringify(picked, null, 2));
    } finally {
      setBusy(false);
    }
  };

  const handlePrepareImport = () => {
    let data;
    try {
      data = JSON.parse(importText);
    } catch (e) {
      setErrors(['To nie jest poprawny JSON']);
      return;
    }
    const problems = validateImport(data);
    setErrors(problems);
    setConfirming(problems.length === 0);
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      const data = JSON.parse(importText);
      const current = await invoke('getProjectConfig', { projectKey: selectedProject });
      const base = current.success && current.config ? current.config : { projectKey: selectedProject };
      const merged = { ...base, projectKey: selectedProject };
      TRANSFERABLE_KEYS.forEach(key => { if (data[key] !== undefined) merged[key] = data[key]; });
      const result = await invoke('saveProjectConfig', { projectKey: selectedProject, config: merged });
      if (result.success) {
        showFlag('success', 'Zaimportowano', 'Konfiguracja zapisana. Odśwież stronę, aby zobaczyć zmiany.');
        setImportText('');
        setConfirming(false);
      } else {
        showFlag('error', 'Błąd', result.error || 'Nie udało się zapisać konfiguracji');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!selectedProject) return null;

  return (
    <div style={{ marginTop: '24px', border: '1px solid #DFE1E6', borderRadius: '3px', background: '#fff' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
      >
        <span>Kopia konfiguracji (eksport / import)</span>
        <span style={{ color: '#5E6C84' }}>{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          <div className="message-box message-warning">
            Konfiguracja zawiera adresy webhooków Teams. Traktuj ją jak hasło: nie wklejaj jej w czatach ani w repozytorium.
          </div>

          <h4 className="section-subtitle">Eksport</h4>
          <p className="form-helper">Domeny, zespoły, harmonogram, pola, reguły priorytetów i ustawienia projektu {selectedProject}.</p>
          <button className="btn btn-default" onClick={handleExport} disabled={busy}>Pokaż konfigurację</button>
          {exported && (
            <textarea
              className="form-textarea"
              readOnly
              rows={10}
              value={exported}
              onFocus={(e) => e.target.select()}
              style={{ marginTop: '12px', fontFamily: 'monospace', fontSize: '12px' }}
              aria-label="Wyeksportowana konfiguracja"
            />
          )}

          <h4 className="section-subtitle" style={{ marginTop: '24px' }}>Import</h4>
          <p className="form-helper">Wklej JSON z eksportu. Zastąpi on odpowiednie części konfiguracji projektu {selectedProject}.</p>
          <textarea
            className="form-textarea"
            rows={8}
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setConfirming(false); setErrors([]); }}
            placeholder='{ "domains": [...], "escalationTeams": [...], "teamSchedule": [...] }'
            style={{ fontFamily: 'monospace', fontSize: '12px' }}
            aria-label="Konfiguracja do zaimportowania"
          />
          {errors.length > 0 && (
            <div className="message-box message-error" style={{ marginTop: '12px' }}>
              <strong>Nie można zaimportować:</strong>
              <ul style={{ margin: '4px 0 0 20px' }}>{errors.slice(0, 8).map(e => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {confirming ? (
            <div className="message-box message-warning" style={{ marginTop: '12px' }}>
              To nadpisze obecną konfigurację projektu {selectedProject}. Kontynuować?
              <div style={{ marginTop: '8px' }}>
                <button className="btn btn-primary btn-small" onClick={handleImport} disabled={busy}>Tak, importuj</button>
                <button className="btn btn-default btn-small" onClick={() => setConfirming(false)}>Anuluj</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={handlePrepareImport} disabled={busy || !importText.trim()}>
              Sprawdź i importuj
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ConfigTransfer;
