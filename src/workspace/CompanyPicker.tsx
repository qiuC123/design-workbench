import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Company } from './types';
import './company-picker.css';

interface CompanyPickerProps {
  companies: Company[];
  value: string;
  onChange: (name: string) => void;
}

const normalize = (name: string) => name.trim().toLocaleLowerCase();

export function CompanyPicker({ companies, value, onChange }: CompanyPickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const options = query === null ? companies : companies.filter(company => normalize(company.name).includes(normalize(query)));
  const activeOption = options[active];
  const hasExactMatch = companies.some(company => normalize(company.name) === normalize(value));

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [expanded]);

  useEffect(() => {
    if (expanded && activeOption) root.current?.querySelector('.cw-company-option.active')?.scrollIntoView({ block: 'nearest' });
  }, [expanded, activeOption]);

  const openAll = () => {
    setQuery(null);
    setActive(companies.findIndex(company => normalize(company.name) === normalize(value)));
    setExpanded(true);
  };

  const choose = (name: string) => {
    onChange(name);
    setExpanded(false);
    setQuery(null);
    setActive(-1);
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) openAll();
      else setActive(index => {
        if (!options.length) return -1;
        if (index < 0) return event.key === 'ArrowDown' ? 0 : options.length - 1;
        return (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      });
    } else if (event.key === 'Enter' && expanded && event.target === input.current) {
      event.preventDefault();
      if (activeOption) choose(activeOption.name);
      else setExpanded(false);
    } else if (event.key === 'Tab') setExpanded(false);
  }

  return <div className="tw-field tw-span-2 cw-company-picker" ref={root} onKeyDown={handleKeyDown} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
  }}>
    <label htmlFor={`${id}-input`}>所属公司</label>
    <div className="cw-company-control">
      <input ref={input} id={`${id}-input`} name="companyName" role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={`${id}-options`} aria-activedescendant={expanded && activeOption ? `${id}-option-${activeOption.id}` : undefined}
        autoComplete="off" maxLength={100} value={value} placeholder="选择或输入客户公司名称"
        onChange={event => { onChange(event.target.value); setQuery(event.target.value); setActive(-1); setExpanded(true); }} />
      <button type="button" className="cw-company-toggle" aria-label={expanded ? '收起所属公司选项' : '展开所属公司选项'}
        aria-expanded={expanded} aria-controls={`${id}-options`} onClick={() => { if (expanded) setExpanded(false); else openAll(); }}>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
    </div>
    {expanded && <div className="cw-company-menu">
      <div className="cw-company-options" id={`${id}-options`} role="listbox" aria-label="客户公司">
        {options.map((company, index) => <div key={company.id} id={`${id}-option-${company.id}`} role="option"
          aria-selected={normalize(company.name) === normalize(value)} className={`cw-company-option${active === index ? ' active' : ''}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(company.name)}>
          <span>{company.name}</span>{normalize(company.name) === normalize(value) && <Check size={16} aria-hidden="true" />}
        </div>)}
        {!options.length && <div className="cw-company-empty" role="status">没有匹配的公司</div>}
      </div>
      <p className="cw-company-hint">{value.trim() && !hasExactMatch ? `保存项目时将新建公司“${value.trim()}”` : '可选择已有公司，也可直接输入新公司名称'}</p>
    </div>}
  </div>;
}
