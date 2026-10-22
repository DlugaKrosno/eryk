import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function PriorityRules({ showFlag, selectedProject, onProjectChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [availableFields, setAvailableFields] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    enabled: true,
    order: 0,
    conditions: [
      {
        field: 'summary',
        operator: 'contains',
        value: ''
      }
    ],
    actions: {
      setPriority: 'P1',
      addWatchers: [] // Tablica accountId użytkowników
    }
  });

  useEffect(() => {
    if (selectedProject) {
      loadRules();
      loadAvailableFields();
      loadUsers();
    } else {
      setLoading(false);
    }
  }, [selectedProject]);
  
  const loadUsers = async () => {
    if (!selectedProject) return;
    
    try {
      const result = await invoke('getProjectUsers', { projectKey: selectedProject });
      
      if (result.success && result.users) {
        setUsers(result.users);
      } else {
        setUsers([]);
      }
    } catch (error) {
      console.error('Błąd ładowania użytkowników:', error);
      setUsers([]);
    }
  };

  const loadRules = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        // Pobierz priorityRules z konfiguracji projektu lub z globalnych
        const rulesData = projectConfigResult.config.priorityRules || 
                         (await invoke('getConfig', { configType: 'rules' })).data || [];
        setRules(Array.isArray(rulesData) ? rulesData : []);
      } else {
        // Fallback do globalnych reguł
        const result = await invoke('getConfig', { configType: 'rules' });
        setRules(result.success && result.data ? (Array.isArray(result.data) ? result.data : []) : []);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się załadować reguł');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableFields = async () => {
    if (!selectedProject) return;
    
    try {
      // Pobierz konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      
      if (projectConfigResult.success && projectConfigResult.config) {
        // Standardowe pola Jira
        const standardFields = [
          { id: 'summary', name: 'Podsumowanie (Summary)', type: 'string' },
          { id: 'description', name: 'Opis (Description)', type: 'string' },
          { id: 'priority', name: 'Priorytet (Priority)', type: 'option' }
        ];
        
        // Skonfigurowane pola z fieldsConfig
        const configuredFields = projectConfigResult.config.fieldsConfig?.configuredFields || [];
        
        // Połącz standardowe pola z skonfigurowanymi
        setAvailableFields([...standardFields, ...configuredFields]);
      } else {
        // Fallback - tylko standardowe pola
        setAvailableFields([
          { id: 'summary', name: 'Podsumowanie (Summary)', type: 'string' },
          { id: 'description', name: 'Opis (Description)', type: 'string' },
          { id: 'priority', name: 'Priorytet (Priority)', type: 'option' }
        ]);
      }
    } catch (error) {
      console.error('Błąd ładowania dostępnych pól:', error);
      // Fallback - tylko standardowe pola
      setAvailableFields([
        { id: 'summary', name: 'Podsumowanie (Summary)', type: 'string' },
        { id: 'description', name: 'Opis (Description)', type: 'string' },
        { id: 'priority', name: 'Priorytet (Priority)', type: 'option' }
      ]);
    }
  };

  const handleAddRule = async () => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!newRule.name.trim()) {
      showFlag('error', 'Błąd', 'Nazwa reguły jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const updatedRules = [...rules, { ...newRule, id: Date.now().toString() }];
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        priorityRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Sukces', 'Reguła priorytetyzacji dodana');
        setRules(updatedRules);
        setShowAddForm(false);
        resetNewRule();
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się dodać reguły');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    if (!window.confirm('Czy na pewno chcesz usunąć tę regułę?')) {
      return;
    }

    try {
      setSaving(true);
      const updatedRules = rules.filter(r => r.id !== ruleId);
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        priorityRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Usunięto', 'Reguła priorytetyzacji usunięta');
        setRules(updatedRules);
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się usunąć reguły');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRule = async (ruleId) => {
    if (!selectedProject) {
      showFlag('error', 'Błąd', 'Wybierz projekt z listy powyżej');
      return;
    }
    
    try {
      setSaving(true);
      const updatedRules = rules.map(r => 
        r.id === ruleId ? editingRule : r
      );
      
      // Pobierz aktualną konfigurację projektu
      const projectConfigResult = await invoke('getProjectConfig', { projectKey: selectedProject });
      const currentConfig = projectConfigResult.success && projectConfigResult.config 
        ? projectConfigResult.config 
        : { projectKey: selectedProject };
      
      // Zaktualizuj konfigurację z nowymi regułami
      const updatedConfig = {
        ...currentConfig,
        priorityRules: updatedRules
      };
      
      const result = await invoke('saveProjectConfig', {
        projectKey: selectedProject,
        config: updatedConfig
      });
      
      if (result.success) {
        showFlag('success', 'Zaktualizowano', 'Reguła priorytetyzacji zaktualizowana');
        setRules(updatedRules);
        setEditingRule(null);
      } else {
        showFlag('error', 'Błąd', result.error);
      }
    } catch (error) {
      showFlag('error', 'Błąd', 'Nie udało się zaktualizować reguły');
    } finally {
      setSaving(false);
    }
  };

  const resetNewRule = () => {
    const firstField = availableFields.length > 0 ? availableFields[0].id : 'summary';
    setNewRule({
      name: '',
      description: '',
      enabled: true,
      order: 0,
      conditions: [
        {
          field: firstField,
          operator: 'contains',
          value: ''
        }
      ],
      actions: {
        setPriority: 'P1',
        addWatchers: []
      }
    });
  };

  const addCondition = (rule, setRule) => {
    const newCondition = {
      field: availableFields.length > 0 ? availableFields[0].id : 'summary',
      operator: 'equals',
      value: ''
    };
    setRule({ ...rule, conditions: [...rule.conditions, newCondition] });
  };

  const removeCondition = (rule, setRule, index) => {
    const updatedConditions = rule.conditions.filter((_, i) => i !== index);
    setRule({ ...rule, conditions: updatedConditions });
  };

  const updateCondition = (rule, setRule, index, field, value) => {
    const updatedConditions = [...rule.conditions];
    updatedConditions[index][field] = value;
    setRule({ ...rule, conditions: updatedConditions });
  };

  const getFieldOptions = () => {
    // Zwróć dostępne pola (standardowe + skonfigurowane)
    return availableFields.map(field => ({
      value: field.id,
      label: field.name
    }));
  };

  const getOperatorOptions = () => [
    { value: 'equals', label: 'Równa się' },
    { value: 'notEquals', label: 'Nie równa się' },
    { value: 'contains', label: 'Zawiera' },
    { value: 'notContains', label: 'Nie zawiera' },
    { value: 'in', label: 'Jest jednym z' }
  ];

  const getValueOptions = (fieldId) => {
    // Znajdź pole w dostępnych polach
    const field = availableFields.find(f => f.id === fieldId);
    
    if (!field) return [];
    
    // Jeśli pole ma allowedValues (np. option, select), zwróć je
    if (field.allowedValues && Array.isArray(field.allowedValues)) {
      return field.allowedValues.map(av => av.name || av.value || av.id);
    }
    
    // Dla standardowych pól priorytetu
    if (fieldId === 'priority') {
      return ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
    }
    
    // Dla innych pól - zwróć pustą tablicę (użytkownik wpisze wartość)
    return [];
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
      <div className="section-header">
        <h3 className="section-title">Reguły Priorytetyzacji</h3>
        <p className="section-description">
          Skonfiguruj reguły automatycznej kalkulacji priorytetu (P1-P4) na podstawie parametrów alertu.
        </p>
      </div>

      {!selectedProject && (
        <div className="message-box message-warning">
          <strong>Wybierz projekt:</strong> Wybierz projekt z listy powyżej, aby skonfigurować reguły priorytetyzacji.
        </div>
      )}

      {selectedProject && (
        <>
      <div className="message-box message-info mb-16">
        <strong>Jak to działa:</strong> Reguły są sprawdzane po kolei według kolejności. Pierwsza pasująca reguła ustala priorytet.
        <br />
        <strong>P1</strong> = Krytyczny | <strong>P2</strong> = Wysoki | <strong>P3</strong> = Średni | <strong>P4</strong> = Niski
      </div>

      {/* Lista Reguł */}
      <div className="mb-16">
        <div className="flex flex-between mb-16">
          <h4 className="section-subtitle">Reguły ({rules.length})</h4>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Anuluj' : 'Dodaj Regułę'}
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="message-box message-warning">
            Brak reguł priorytetyzacji. Alerty będą otrzymywać domyślny priorytet (P3).
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Kolejność</th>
                <th>Nazwa</th>
                <th>Warunki</th>
                <th>Priorytet</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {rules.sort((a, b) => a.order - b.order).map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.order}</td>
                  <td>
                    <strong>{rule.name}</strong>
                    {rule.description && <><br /><small>{rule.description}</small></>}
                  </td>
                  <td>
                    <small>
                      {rule.conditions.map((cond, i) => (
                        <div key={i}>
                          {i > 0 && 'AND '}
                          <strong>{getFieldOptions().find(f => f.value === cond.field)?.label || cond.field}</strong>{' '}
                          {getOperatorOptions().find(o => o.value === cond.operator)?.label || cond.operator}{' '}
                          "<em>{cond.value}</em>"
                        </div>
                      ))}
                    </small>
                  </td>
                  <td>
                    <span className={`priority-badge priority-${rule.actions.setPriority}`}>
                      {rule.actions.setPriority}
                    </span>
                  </td>
                  <td>
                    <span className={rule.enabled ? 'badge-success' : 'badge-disabled'}>
                      {rule.enabled ? 'Aktywna' : 'Nieaktywna'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => setEditingRule(rule)}
                    >
                      Edytuj
                    </button>
                    <button
                      className="btn btn-default btn-small"
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={saving}
                    >
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Formularz Dodawania/Edycji */}
      {(showAddForm || editingRule) && (
        <div className="rule-form-container">
          <h4 className="section-subtitle">{editingRule ? 'Edytuj Regułę' : 'Nowa Reguła Priorytetyzacji'}</h4>
          
          {renderRuleForm(
            editingRule || newRule,
            editingRule ? setEditingRule : setNewRule,
            editingRule ? () => handleUpdateRule(editingRule.id) : handleAddRule,
            editingRule ? () => setEditingRule(null) : () => setShowAddForm(false)
          )}
        </div>
      )}
        </>
      )}
    </div>
  );

  function renderRuleForm(rule, setRule, onSave, onCancel) {
    return (
      <div className="form-container">
        <div className="form-group">
          <label className="form-label">Nazwa Reguły *</label>
          <input
            type="text"
            className="form-input"
            placeholder="np. Alerty krytyczne w produkcji"
            value={rule.name}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Opis</label>
          <textarea
            className="form-textarea"
            placeholder="Opcjonalny opis reguły"
            value={rule.description}
            onChange={(e) => setRule({ ...rule, description: e.target.value })}
            rows={2}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Kolejność (priorytet wykonania)</label>
          <input
            type="number"
            className="form-input"
            value={rule.order}
            onChange={(e) => setRule({ ...rule, order: parseInt(e.target.value) || 0 })}
          />
          <div className="form-helper">Niższy numer = wyższy priorytet. Pierwsza pasująca reguła wygrywa.</div>
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              className="form-checkbox"
              checked={rule.enabled}
              onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
            />
            Reguła aktywna
          </label>
        </div>

        <hr />
        <h5>Warunki (wszystkie muszą być spełnione)</h5>

        {rule.conditions.map((condition, index) => (
          <div key={index} className="condition-block">
            <div className="flex flex-gap">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Pole</label>
                <select
                  className="form-select"
                  value={condition.field}
                  onChange={(e) => updateCondition(rule, setRule, index, 'field', e.target.value)}
                >
                  {getFieldOptions().map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Operator</label>
                <select
                  className="form-select"
                  value={condition.operator}
                  onChange={(e) => updateCondition(rule, setRule, index, 'operator', e.target.value)}
                >
                  {getOperatorOptions().map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Wartość</label>
                {getValueOptions(condition.field).length > 0 ? (
                  <select
                    className="form-select"
                    value={condition.value}
                    onChange={(e) => updateCondition(rule, setRule, index, 'value', e.target.value)}
                  >
                    <option value="">-- Wybierz --</option>
                    {getValueOptions(condition.field).map(val => (
                      <option key={val} value={val}>{val}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Wpisz wartość"
                    value={condition.value}
                    onChange={(e) => updateCondition(rule, setRule, index, 'value', e.target.value)}
                  />
                )}
              </div>

              <div style={{ paddingTop: '28px' }}>
                <button
                  type="button"
                  className="btn btn-default btn-small"
                  onClick={() => removeCondition(rule, setRule, index)}
                  disabled={rule.conditions.length === 1}
                  title={rule.conditions.length === 1 ? 'Musi być co najmniej jeden warunek' : 'Usuń warunek'}
                >
                  Usuń
                </button>
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          className="btn btn-default mt-16"
          onClick={() => addCondition(rule, setRule)}
        >
          Dodaj Warunek (AND)
        </button>

        <hr />
        <h5>Akcje</h5>

        <div className="message-box message-info mb-16">
          <strong>Uwaga:</strong> Zespół i osoba przypisana są automatycznie wybierane na podstawie harmonogramu dyżurów (zakładka "Zespoły"). Osoba przypisana jest określona w harmonogramie dla każdego tygodnia.
        </div>

        <div className="form-group">
          <label className="form-label">Ustaw Priorytet</label>
          <select
            className="form-select"
            value={rule.actions.setPriority}
            onChange={(e) => setRule({ ...rule, actions: { ...rule.actions, setPriority: e.target.value } })}
          >
            <option value="P1">P1 - Krytyczny</option>
            <option value="P2">P2 - Wysoki</option>
            <option value="P3">P3 - Średni</option>
            <option value="P4">P4 - Niski</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Dodaj Obserwatorów (można wybrać wielu)</label>
          <select
            className="form-select"
            multiple
            size={5}
            value={Array.isArray(rule.actions.addWatchers) ? rule.actions.addWatchers : []}
            onChange={(e) => {
              const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
              setRule({ ...rule, actions: { ...rule.actions, addWatchers: selectedOptions } });
            }}
          >
            {users.map(user => (
              <option key={user.accountId} value={user.accountId}>
                {user.displayName} ({user.emailAddress})
              </option>
            ))}
          </select>
          <div className="form-helper">
            Przytrzymaj Ctrl (lub Cmd na Mac) aby wybrać wielu użytkowników. Obserwatorzy zostaną automatycznie dodani do zgłoszenia, gdy reguła zostanie zastosowana.
            {Array.isArray(rule.actions.addWatchers) && rule.actions.addWatchers.length > 0 && (
              <div className="mt-8">
                <strong>Wybrani obserwatorzy ({rule.actions.addWatchers.length}):</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  {rule.actions.addWatchers.map(accountId => {
                    const user = users.find(u => u.accountId === accountId);
                    return (
                      <li key={accountId}>
                        {user ? `${user.displayName} (${user.emailAddress})` : accountId}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-gap mt-16">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !rule.name.trim()}
          >
            {saving ? 'Zapisywanie...' : 'Zapisz Regułę'}
          </button>
          <button
            type="button"
            className="btn btn-default"
            onClick={onCancel}
          >
            Anuluj
          </button>
        </div>
      </div>
    );
  }
}

export default PriorityRules;
