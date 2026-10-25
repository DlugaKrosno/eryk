import React, { useState } from 'react';
import { toStr, addDays, formatDate, nextMonday, shiftStatus, overlaps } from './dutyDates';

const STATUS_STYLE = {
  active: { label: 'Trwa', background: '#36B37E', color: '#fff' },
  upcoming: { label: 'Nadchodzi', background: '#DEEBFF', color: '#0747A6' },
  past: { label: 'Zakończony', background: '#EBECF0', color: '#5E6C84' }
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 600, background: s.background, color: s.color }}>
      {s.label}
    </span>
  );
}

// Harmonogram dyżurów: osobna karta dla każdego zespołu. Dyżurnego wybiera się spośród delegatów zespołu.
// editableTeamIds: lista zespołów, które użytkownik może zmieniać (null = wszystkie, np. administrator w panelu konfiguracji)
function DutySchedule({ teams, schedule, users, saving, onSave, editableTeamIds = null }) {
  const canEditTeam = (teamId) => !editableTeamIds || editableTeamIds.includes(teamId);
  const today = toStr(new Date());
  const [drafts, setDrafts] = useState({}); // teamId -> { assignedPerson, startDate, endDate }
  const [editing, setEditing] = useState(null); // { id, assignedPerson, startDate, endDate }
  const [showPast, setShowPast] = useState({});
  const [errors, setErrors] = useState({}); // teamId | 'edit' -> komunikat

  const userName = (accountId) => (users.find(u => u.accountId === accountId) || {}).displayName || accountId || '-';
  const delegatesOf = (team) => users.filter(u => (team.delegates || []).includes(u.accountId));
  const shiftsOf = (teamId) => schedule
    .filter(s => s.teamId === teamId)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  const setError = (key, message) => setErrors(prev => ({ ...prev, [key]: message }));

  const validate = (candidate, ignoreId) => {
    if (!candidate.assignedPerson) return 'Wybierz osobę na dyżur';
    if (!candidate.startDate || !candidate.endDate) return 'Podaj datę początku i końca';
    if (candidate.endDate < candidate.startDate) return 'Data końca nie może być wcześniejsza niż początku';
    const clash = schedule.find(s => s.teamId === candidate.teamId && s.id !== ignoreId && overlaps(s, candidate));
    if (clash) {
      return `Dyżur nakłada się na ${userName(clash.assignedPerson)} (${formatDate(clash.startDate)} - ${formatDate(clash.endDate)})`;
    }
    return null;
  };

  const getDraft = (team) => {
    if (drafts[team.id]) return drafts[team.id];
    // Domyślnie proponujemy kolejny tydzień po ostatnim dyżurze zespołu
    const upcoming = shiftsOf(team.id).filter(s => s.endDate >= today);
    const last = upcoming[upcoming.length - 1];
    const startDate = last ? addDays(last.endDate, 1) : nextMonday(new Date());
    return { assignedPerson: '', startDate, endDate: addDays(startDate, 6) };
  };

  const updateDraft = (team, patch) => setDrafts(prev => ({ ...prev, [team.id]: { ...getDraft(team), ...patch } }));

  const handleAdd = async (team) => {
    const draft = getDraft(team);
    const candidate = { ...draft, teamId: team.id };
    const problem = validate(candidate, null);
    if (problem) {
      setError(team.id, problem);
      return;
    }
    setError(team.id, null);
    const ok = await onSave([...schedule, { ...candidate, id: `shift-${Date.now()}` }]);
    if (ok) setDrafts(prev => { const next = { ...prev }; delete next[team.id]; return next; });
  };

  const handleSaveEdit = async () => {
    const original = schedule.find(s => s.id === editing.id);
    const candidate = { ...original, assignedPerson: editing.assignedPerson, startDate: editing.startDate, endDate: editing.endDate };
    const problem = validate(candidate, editing.id);
    if (problem) {
      setError('edit', problem);
      return;
    }
    setError('edit', null);
    const ok = await onSave(schedule.map(s => s.id === editing.id ? candidate : s));
    if (ok) setEditing(null);
  };

  const handleDelete = async (shift) => {
    if (!window.confirm(`Usunąć dyżur ${userName(shift.assignedPerson)} (${formatDate(shift.startDate)} - ${formatDate(shift.endDate)})?`)) return;
    await onSave(schedule.filter(s => s.id !== shift.id));
  };

  const renderShiftRow = (shift) => {
    const isEditing = editing && editing.id === shift.id;
    const team = teams.find(t => t.id === shift.teamId);
    const people = team ? delegatesOf(team) : [];
    const status = shiftStatus(shift, today);

    if (isEditing) {
      return (
        <tr key={shift.id}>
          <td>
            <select
              className="form-select"
              value={editing.assignedPerson}
              onChange={(e) => setEditing({ ...editing, assignedPerson: e.target.value })}
            >
              <option value="">-- Wybierz --</option>
              {people.map(u => <option key={u.accountId} value={u.accountId}>{u.displayName}</option>)}
            </select>
          </td>
          <td>
            <input type="date" className="form-input" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} />
          </td>
          <td>
            <input type="date" className="form-input" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} />
          </td>
          <td><StatusBadge status={status} /></td>
          <td>
            <button className="btn btn-primary btn-small" onClick={handleSaveEdit} disabled={saving}>Zapisz</button>
            <button className="btn btn-default btn-small" onClick={() => { setEditing(null); setError('edit', null); }}>Anuluj</button>
          </td>
        </tr>
      );
    }

    return (
      <tr key={shift.id} style={status === 'past' ? { opacity: 0.6 } : undefined}>
        <td><strong>{userName(shift.assignedPerson)}</strong></td>
        <td>{formatDate(shift.startDate)}</td>
        <td>{formatDate(shift.endDate)}</td>
        <td><StatusBadge status={status} /></td>
        {canEditTeam(shift.teamId) ? <td>
          <button
            className="btn btn-default btn-small"
            onClick={() => { setEditing({ id: shift.id, assignedPerson: shift.assignedPerson || '', startDate: shift.startDate, endDate: shift.endDate }); setError('edit', null); }}
          >
            Edytuj
          </button>
          <button className="btn btn-default btn-small" onClick={() => handleDelete(shift)} disabled={saving}>Usuń</button>
        </td> : <td></td>}
      </tr>
    );
  };

  const renderTeamCard = (team) => {
    const shifts = shiftsOf(team.id);
    const current = shifts.find(s => shiftStatus(s, today) === 'active');
    const visible = shifts.filter(s => shiftStatus(s, today) !== 'past');
    const past = shifts.filter(s => shiftStatus(s, today) === 'past');
    const people = delegatesOf(team);
    const canEdit = canEditTeam(team.id);
    const draft = getDraft(team);
    const editingHere = editing && shifts.some(s => s.id === editing.id);

    return (
      <div key={team.id} style={{ border: '1px solid #DFE1E6', borderRadius: '3px', marginBottom: '16px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', padding: '12px 16px', background: '#F4F5F7', borderBottom: '1px solid #DFE1E6' }}>
          <strong style={{ fontSize: '15px' }}>{team.name}</strong>
          {current ? (
            <span style={{ color: '#006644', fontWeight: 600 }}>
              Dyżur teraz: {userName(current.assignedPerson)} (do {formatDate(current.endDate)})
            </span>
          ) : (
            <span style={{ color: '#974F0C', fontWeight: 600 }}>Dziś nikt nie ma dyżuru</span>
          )}
        </div>

        <div style={{ padding: '16px' }}>
          {canEdit && people.length === 0 && (
            <div className="message-box message-warning">
              Ten zespół nie ma delegatów do dyżuru. Dodaj ich w tabeli zespołów powyżej (Edytuj → Delegaci do dyżuru), a potem zaplanuj dyżury.
            </div>
          )}

          {visible.length === 0 && past.length === 0 ? (
            <div className="form-helper" style={{ marginBottom: '12px' }}>Brak zaplanowanych dyżurów.</div>
          ) : (
            <table className="table" style={{ marginBottom: '12px' }}>
              <thead>
                <tr><th>Dyżurny</th><th>Od</th><th>Do</th><th>Status</th><th>Akcje</th></tr>
              </thead>
              <tbody>
                {visible.map(renderShiftRow)}
                {showPast[team.id] && past.slice().reverse().map(renderShiftRow)}
              </tbody>
            </table>
          )}
          {editingHere && errors.edit && <div className="message-box message-error">{errors.edit}</div>}

          {past.length > 0 && (
            <button
              className="btn btn-default btn-small"
              style={{ marginBottom: '12px' }}
              onClick={() => setShowPast(prev => ({ ...prev, [team.id]: !prev[team.id] }))}
            >
              {showPast[team.id] ? 'Ukryj zakończone' : `Pokaż zakończone (${past.length})`}
            </button>
          )}

          {!canEdit && (
            <div className="form-helper">Tylko do odczytu: harmonogram tego zespołu zmienia jego team leader.</div>
          )}

          {canEdit && people.length > 0 && (
            <div style={{ borderTop: shifts.length > 0 ? '1px solid #EBECF0' : 'none', paddingTop: shifts.length > 0 ? '12px' : 0 }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>Dodaj dyżur</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label className="form-label">Dyżurny</label>
                  <select className="form-select" value={draft.assignedPerson} onChange={(e) => updateDraft(team, { assignedPerson: e.target.value })}>
                    <option value="">-- Wybierz delegata --</option>
                    {people.map(u => <option key={u.accountId} value={u.accountId}>{u.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Od</label>
                  <input type="date" className="form-input" value={draft.startDate} onChange={(e) => updateDraft(team, { startDate: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Do</label>
                  <input type="date" className="form-input" value={draft.endDate} onChange={(e) => updateDraft(team, { endDate: e.target.value })} />
                </div>
                <button className="btn btn-primary" onClick={() => handleAdd(team)} disabled={saving}>Dodaj dyżur</button>
              </div>
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="form-helper" style={{ margin: 0 }}>Skróty:</span>
                <button className="btn btn-default btn-small" onClick={() => updateDraft(team, { endDate: addDays(draft.startDate, 6) })}>1 tydzień</button>
                <button className="btn btn-default btn-small" onClick={() => updateDraft(team, { endDate: addDays(draft.startDate, 13) })}>2 tygodnie</button>
                <button className="btn btn-default btn-small" onClick={() => updateDraft(team, { endDate: draft.startDate })}>1 dzień</button>
              </div>
              {errors[team.id] && <div className="message-box message-error" style={{ marginTop: '12px' }}>{errors[team.id]}</div>}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-16">
      <h4 className="section-subtitle">Harmonogram dyżurów</h4>
      <div className="form-helper mb-16">
        Każdy zespół ma własny harmonogram. Alert z domeny zespołu trafia do osoby, która ma dziś dyżur.
        Zmiany zapisują się od razu.
      </div>

      {teams.length === 0 ? (
        <div className="message-box message-info">Najpierw dodaj zespół (lub domenę, która utworzy zespół).</div>
      ) : (
        teams.map(renderTeamCard)
      )}
    </div>
  );
}

export default DutySchedule;
