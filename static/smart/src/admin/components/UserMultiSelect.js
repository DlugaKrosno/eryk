import React, { useState } from 'react';
import { filterUsers } from './userFilter';

// Wielokrotny wybór osób (accountId) z wyszukiwarką. Bez listy użytkowników - pole tekstowe z accountId po przecinku.
function UserMultiSelect({ users, value, onChange, emptyHint }) {
  const [query, setQuery] = useState('');
  const selected = Array.isArray(value) ? value : [];

  if (!users || users.length === 0) {
    return (
      <input
        type="text"
        className="form-input"
        placeholder={emptyHint || 'Account ID oddzielone przecinkami'}
        value={selected.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map(v => v.trim()).filter(Boolean))}
      />
    );
  }

  const toggle = (accountId) => {
    onChange(selected.includes(accountId)
      ? selected.filter(id => id !== accountId)
      : [...selected, accountId]);
  };

  const nameOf = (accountId) => (users.find(u => u.accountId === accountId) || {}).displayName || accountId;
  const visible = filterUsers(users, query);

  return (
    <div>
      {/* Wybrane osoby zawsze widać, także gdy filtr je ukrywa na liście */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }} aria-label="Wybrane osoby">
          {selected.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#DEEBFF', color: '#0747A6', borderRadius: '3px', fontSize: '13px' }}>
              {nameOf(id)}
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Usuń ${nameOf(id)}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0747A6', padding: 0, lineHeight: 1, fontSize: '14px' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="search"
        className="form-input"
        placeholder="Szukaj osoby (imię, nazwisko, e-mail)..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Szukaj osoby"
        style={{ marginBottom: '6px' }}
      />

      <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #DFE1E6', borderRadius: '3px', padding: '6px 8px' }}>
        {visible.length === 0 ? (
          <div style={{ color: '#5E6C84', fontSize: '13px' }}>Brak osób pasujących do "{query}".</div>
        ) : (
          visible.map(user => (
            <label key={user.accountId} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(user.accountId)}
                onChange={() => toggle(user.accountId)}
              />
              <span>{user.displayName}{user.emailAddress ? ` (${user.emailAddress})` : ''}</span>
            </label>
          ))
        )}
      </div>
      <div className="form-helper">
        {query ? `Znaleziono ${visible.length} z ${users.length}. ` : ''}Wybrano: {selected.length}
      </div>
    </div>
  );
}

export default UserMultiSelect;
