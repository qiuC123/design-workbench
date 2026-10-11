import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, MoveHorizontal, Plus, Users } from 'lucide-react';
import { addDays, MANAGERS, nextFreeDate, personDay, PROJECT_LABELS, today, validDate, weekStart } from './model';
import type { Project, WorkbenchState } from './types';
import './schedule-timeline.css';

const DAYS = 28;
const fmt = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const distance = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

interface Props {
  state: WorkbenchState;
  date: string;
  ownerFilter: string;
  freeOnly: boolean;
  companyScoped: boolean;
  scopeProjects: Project[];
  visibleProjects: Project[];
  focusId?: string;
  onDateChange: (date: string) => void;
  onFreeOnlyChange: (value: boolean) => void;
  onOpenProject: (id?: string, ownerId?: string, date?: string) => void;
  onUnassigned: () => void;
  onShowProject: (project: Project) => void;
  companyLabel: (project: Project) => string;
}

export default function ScheduleTimeline(props: Props) {
  const { state, date, ownerFilter, freeOnly, companyScoped, scopeProjects, visibleProjects, focusId, onDateChange, onFreeOnlyChange, onOpenProject, onUnassigned, onShowProject, companyLabel } = props;
  const [rangeStart, setRangeStart] = useState(() => weekStart(date));
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(rangeStart, i));
  const rangeEnd = dates[DAYS - 1];
  const managers = MANAGERS.filter(m => (ownerFilter === 'all' || ownerFilter === m.id) && (!freeOnly || personDay(state, m.id, date).free));
  const unassigned = scopeProjects.filter(p => !p.ownerIds.length && p.status !== 'done').length;

  // Keep scrolling intact during background sync, filtering and editor updates.
  // Only a selected date outside the visible window changes the date range.
  useEffect(() => {
    if (date < rangeStart || date > rangeEnd) { setRangeStart(weekStart(date)); return; }
    const root = scroller.current;
    const heading = root?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    const personWidth = root?.querySelector<HTMLElement>('.cw-timeline-corner')?.offsetWidth || 0;
    if (!root || !heading) return;
    const viewport = root.getBoundingClientRect(), selected = heading.getBoundingClientRect();
    if (selected.left < viewport.left + personWidth) root.scrollLeft -= viewport.left + personWidth - selected.left;
    else if (selected.right > viewport.right) root.scrollLeft += selected.right - viewport.right;
  }, [date, rangeStart, rangeEnd]);

  function jumpTo(day: string) {
    setRangeStart(weekStart(day));
    if (scroller.current) scroller.current.scrollLeft = 0;
    onDateChange(day);
  }
  function shiftWeek(offset: number) {
    setRangeStart(addDays(rangeStart, offset));
    onDateChange(addDays(date, offset));
  }
  function scrollWeek(direction: number) {
    const root = scroller.current;
    const dayWidth = root?.querySelector<HTMLElement>('.tw-day')?.offsetWidth || 104;
    root?.scrollBy({ left: direction * 7 * dayWidth, behavior: 'smooth' });
  }

  return <section className="cw-schedule-view" aria-label="连续四周人员排班">
    <div className="tw-date-toolbar">
      <div className="tw-date-control">
        <button className="tw-icon-button" aria-label="上一周" onClick={() => shiftWeek(-7)}><ArrowLeft size={17} /></button>
        <strong className="tw-week-title">{rangeStart.slice(0, 4)} 年 · {fmt(rangeStart)} — {fmt(rangeEnd)}<small>连续 4 周</small></strong>
        <button className="tw-icon-button" aria-label="下一周" onClick={() => shiftWeek(7)}><ArrowRight size={17} /></button>
        <button className="tw-button small" onClick={() => jumpTo(today())}>今天</button>
      </div>
      <label className="tw-date-control">查看某一天<input aria-label="查看日期" type="date" value={date} onChange={e => { if (validDate(e.target.value)) jumpTo(e.target.value); }} /></label>
    </div>
    <div className="tw-legend"><span><i className="todo" />待办</span><span><i className="doing" />进行中</span><span><i className="review" />待核验</span><label><input type="checkbox" checked={freeOnly} onChange={e => onFreeOnlyChange(e.target.checked)} />仅看 {fmt(date)} 空闲</label></div>
    <p className="tw-note">{companyScoped ? '只展示该公司的项目，忙闲按全部项目计算。' : '多人项目显示在每位负责人的行中，已完成项目释放排班。'} 点击日期查看当天忙闲，点击项目查看详情。</p>
    {unassigned > 0 && <div className="tw-notice"><p>有 {unassigned} 个项目待分配负责人。</p><button className="tw-button ghost small" onClick={onUnassigned}>去分配<ArrowRight size={14} /></button></div>}
    <div className="cw-timeline-tools"><span><MoveHorizontal size={16} />左右滑动看排班<span className="cw-desktop-hint"> · 也可按住拖动</span></span><div><button type="button" className="tw-icon-button" aria-label="向左滚动一周" onClick={() => scrollWeek(-1)}><ArrowLeft size={16} /></button><button type="button" className="tw-icon-button" aria-label="向右滚动一周" onClick={() => scrollWeek(1)}><ArrowRight size={16} /></button></div></div>
    <div ref={scroller} className={`cw-timeline ${dragging ? 'is-dragging' : ''}`} role="region" aria-label="人员排班时间表，可左右滑动" tabIndex={0}
      onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0) { drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }; suppressClick.current = false; } }}
      onPointerMove={event => {
        if (!drag.current) return;
        const delta = event.clientX - drag.current.x;
        if (!drag.current.moved && Math.abs(delta) > 5) { drag.current.moved = true; suppressClick.current = true; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }
        if (drag.current.moved) { event.preventDefault(); event.currentTarget.scrollLeft = drag.current.left - delta; }
      }}
      onPointerUp={event => { drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; suppressClick.current = false; setDragging(false); }}
      onPointerLeave={() => { if (drag.current && !drag.current.moved) drag.current = null; }}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <div className="cw-timeline-grid" style={{ '--days': DAYS } as CSSProperties}>
        <div className="cw-timeline-head"><div className="cw-timeline-corner"><Users size={15} /><strong>负责人</strong><small>{fmt(date)} 的忙闲 · {managers.length} 人</small></div>{dates.map((day, index) => <button key={day} type="button" data-date={day} data-week-start={index % 7 === 0} className={`tw-day ${day === date ? 'selected' : ''} ${day === today() ? 'today' : ''}`} aria-label={`查看${day}排班`} aria-pressed={day === date} onClick={() => onDateChange(day)}><span>周{'一二三四五六日'[index % 7]}</span><strong>{fmt(day)}</strong><small>{day === today() ? '今天' : day === date ? '已选' : index % 7 >= 5 ? '周末' : '\u00a0'}</small></button>)}</div>
        {managers.map(manager => {
          const day = personDay(state, manager.id, date);
          const projects = visibleProjects.filter(project => project.ownerIds.includes(manager.id) && project.startDate <= rangeEnd && project.endDate >= rangeStart).sort((a, b) => a.startDate.localeCompare(b.startDate));
          const next = !projects.length ? visibleProjects.filter(project => project.ownerIds.includes(manager.id) && project.startDate > rangeEnd).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] : undefined;
          return <div className="cw-timeline-row" key={manager.id} data-member-id={manager.id}>
            <div className="tw-person-info"><div className="tw-person-name"><span aria-hidden="true" className="tw-avatar" style={{ background: manager.color }}>{manager.name.slice(-2)}</span><strong>{manager.name}</strong></div><span className={`tw-availability ${day.free ? 'free' : 'busy'}`}>{day.free ? '当天空闲' : `${day.projects.length} 个项目${day.overlapping ? ' · 并行' : ''}`}</span><small className="tw-next-free">{day.free ? '可安排项目' : `最早空闲 ${fmt(nextFreeDate(state, manager.id, date))}`}</small><button type="button" className="tw-button ghost small" onClick={() => onOpenProject(undefined, manager.id, date)}><Plus size={13} />安排项目</button></div>
            <div className="tw-person-track"><div className="tw-grid-lines">{dates.map((day, index) => <span key={day} data-week-start={index % 7 === 0} className={day === date ? 'selected' : index % 7 >= 5 ? 'weekend' : ''} />)}</div>
              {projects.map((project, index) => {
                const first = Math.max(0, distance(project.startDate, rangeStart)), last = Math.min(DAYS - 1, distance(project.endDate, rangeStart));
                return <button type="button" key={project.id} className="tw-task-bar" data-focused={focusId === project.id} data-status={project.status} data-task-id={project.id} aria-label={`调整项目 ${project.title}`} title={`${project.title} · ${companyLabel(project)} · ${fmt(project.startDate)}—${fmt(project.endDate)}`} onClick={() => onOpenProject(project.id)} style={{ gridColumn: `${first + 1} / span ${last - first + 1}`, gridRow: index + 1 }}><span className="cw-bar-caption"><strong>{project.title}</strong><small>{companyLabel(project)} · {PROJECT_LABELS[project.status]}</small><small>{fmt(project.startDate)} — {fmt(project.endDate)}</small></span></button>;
              })}
              {!projects.length && <div className="cw-track-empty"><span>{companyScoped ? '这四周暂无该公司项目' : '这四周暂无项目安排'}{next && <button type="button" onClick={() => onShowProject(next)}><CalendarDays size={13} />下一项 {fmt(next.startDate)} · {next.title}<ArrowRight size={13} /></button>}</span></div>}
              {dates.map((day, index) => <button type="button" key={day} className="tw-add-day" style={{ gridColumn: index + 1, gridRow: Math.max(projects.length, 1) + 1 }} aria-label={`给${manager.name}安排${day}项目`} onClick={() => onOpenProject(undefined, manager.id, day)}><Plus size={14} /></button>)}
            </div>
          </div>;
        })}
      </div>
      {!managers.length && <div className="tw-empty">当前筛选下没有负责人，可取消空闲筛选。</div>}
    </div>
  </section>;
}
