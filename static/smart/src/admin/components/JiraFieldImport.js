import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import { planFieldImport, applyFieldImport } from './domainImport';

// Domeny z pola Jira jednokrotnego wyboru: opcje pola stają się domenami (każda z własnym zespołem).
// Wartość pola jest potem ustawiana w alercie, a zmiana wartości w Jirze zmienia zespół alertu.
function JiraFieldImport({ showFlag, selectedProject, issueTypeId, domains, teams, domainFieldId, persist, onApplied }) {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fieldId, setFieldId] = useState(domainFieldId || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setFieldId(domainFieldId || ''); }, [domainFieldId]);

  useEffect(() => {
    if (!selectedProject || !issueTypeId) return;
    let cancelled = false;
    setLoading(true);
    invoke('getIssueTypeFields', { projectKey: selectedProject, issueTypeId })
      .then(result => {
        if (cancelled) return;
        // Pola jedno- i wielokrotnego wyboru (lista opcji): wielokrotny wybór to type=array z elementami typu option
        const selects = (result.fields || []).filter(f =>
          (f.type === 'option' || (f.type === 'array' && f.itemsType === 'option')) &&
          Array.isArray(f.allowedValues) && f.allowedValues.length > 0
        );
        setFields(selects);
      })
      .catch(() => { if (!cancelled) showFlag('error', 'Błąd', 'Nie udało się pobrać pól Jira'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedProject, issueTypeId]);

  if (!issueTypeId) {
    return (
      <div className="message-box message-info">
        Aby pobrać domeny z pola Jira, najpierw wybierz typ alertu w zakładce "Ustawienia Ogólne".
      </div>
    );
  }

  const field = fields.find(f => f.id === fieldId);
  const plan = field ? planFieldImport(field.allowedValues, domains) : null;
  const pending = plan ? plan.toCreate.length + plan.toLink.length : 0;
  const needsSave = fieldId !== (domainFieldId || '');

  const handleApply = async () => {
    setSaving(true);
    try {
      const result = applyFieldImport(plan, domains, teams);
      if (await persist(result.domains, result.teams, { domainFieldId: fieldId, domainFieldMulti: field.type === 'array' })) {
        onApplied(result.domains, result.teams, fieldId);
        showFlag('success', 'Zapisano', `Utworzono ${plan.toCreate.length}, połączono ${plan.toLink.length} domen z polem "${field.name}"`);
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać domen');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDetach = async () => {
    setSaving(true);
    try {
      if (await persist(domains, teams, { domainFieldId: '', domainFieldMulti: false })) {
        onApplied(domains, teams, '');
        showFlag('success', 'Zapisano', 'Odłączono pole Jira (domeny zostają)');
      } else {
        showFlag('error', 'Błąd', 'Nie udało się zapisać');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-16" style={{ padding: '12px 16px', border: '1px solid #DFE1E6', borderRadius: '3px' }}>
      <h4 className="section-subtitle" style={{ marginTop: 0 }}>Domeny z pola Jira</h4>
      <div className="form-helper" style={{ marginBottom: '8px' }}>
        Wybierz pole jedno- lub wielokrotnego wyboru (np. "Domena"). Każda jego wartość stanie się domeną z własnym zespołem.
        Pole będzie ustawiane w alercie, a gdy ktoś zmieni jego wartość w Jirze, alert przejdzie do zespołu nowej domeny.
        Pole musi być na ekranie tworzenia i edycji alertów.
      </div>

      {loading ? (
        <div style={{ color: '#5E6C84' }}>Ładowanie pól...</div>
      ) : fields.length === 0 ? (
        <div className="message-box message-warning">
          Nie znaleziono pól z listą wyboru na ekranie tworzenia tego typu alertu.
        </div>
      ) : (
        <>
          <label className="form-label" htmlFor="domain-field">Pole Jira</label>
          <select id="domain-field" className="form-select" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
            <option value="">-- Wybierz pole --</option>
            {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.type === 'array' ? 'wielokrotny wybór' : 'jednokrotny wybór'}, {f.allowedValues.length} wartości)</option>)}
          </select>

          {field && field.type === 'array' && (
            <div className="form-helper" style={{ marginTop: '8px' }}>
              To pole pozwala wybrać wiele wartości. Aplikacja ustawia w alercie jedną (wybraną kategorię), a gdy alert ma kilka wartości, o zespole decyduje pierwsza z przypisaną domeną. Jedną wartość w formularzu wymusisz w zakładce Konfiguracja Pól (opcja "Pojedynczy wybór").
            </div>
          )}

          {plan && (
            <div style={{ marginTop: '12px' }}>
              <table className="table">
                <thead><tr><th>Wartość pola</th><th>Co się stanie</th></tr></thead>
                <tbody>
                  {field.allowedValues.map(opt => {
                    const id = String(opt.id);
                    const create = plan.toCreate.find(c => c.optionId === id);
                    const link = plan.toLink.find(l => l.optionId === id);
                    return (
                      <tr key={id}>
                        <td>{opt.name || opt.value}</td>
                        <td>{create ? 'Nowa domena i zespół' : link ? 'Połączenie z istniejącą domeną o tej nazwie' : 'Już powiązana'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn btn-primary" onClick={handleApply} disabled={saving || (pending === 0 && !needsSave)}>
                {saving ? 'Zapisuję...' : pending > 0 ? `Zaimportuj (${pending})` : 'Zapisz wybór pola'}
              </button>
            </div>
          )}

          {domainFieldId && (
            <button className="btn btn-default btn-small" style={{ marginLeft: plan ? '8px' : 0, marginTop: '8px' }} onClick={handleDetach} disabled={saving}>
              Odłącz pole
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default JiraFieldImport;
