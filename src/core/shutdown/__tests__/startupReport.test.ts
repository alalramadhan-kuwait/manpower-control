import { describe, expect, it } from 'vitest';
import { startupReport, stepClass, type ReportStep } from '../startupReport';

// Train-2 start-up as it stood at 13 Nov 2026 11:05 (Kuwait = UTC+3)
const k = (s: string) => new Date(`${s}+03:00`).toISOString();
const st = (id: string, title: string, h: number, extra: Partial<ReportStep> = {}): ReportStep => ({ id, title, stdHours: h, status: 'not_started', startedAt: null, doneAt: null, ...extra });
const steps: ReportStep[] = [
  st('1', 'Pull vacuum', 8, { status: 'done', startedAt: k('2026-11-12T10:00'), doneAt: k('2026-11-12T19:51'), delayReason: 'equipment', delayNote: 'Open flang found on EA-201' }),
  st('2', 'Deblinding (including segregation) · commission flare header', 8, { status: 'done', startedAt: k('2026-11-12T19:51'), doneAt: k('2026-11-13T03:51') }),
  st('3', 'Pressurize and test with N2 @ 20–25 psig', 4, { status: 'done', startedAt: k('2026-11-13T03:51'), doneAt: k('2026-11-13T08:50') }),
  st('4', 'Pressurize and test with H2 @ 475 psig (100 psi/h)', 6),
  st('5', 'Commission recycle gas compressor C-201 to operating speed', 6),
  st('6', 'Heat up R-205 inlets to 350 °F by commissioning heaters', 12),
  st('7', 'Reach min skin 125 °F · system pressure 525 psig', 8), st('8', 'Reach min skin 130 °F · system pressure 750 psig', 8),
  st('9', 'Reach min skin 140 °F · system pressure 800 psig', 8), st('10', 'Reach min skin 150 °F · system pressure 1000 psig', 6),
  st('11', 'Reach min skin 180 °F · system pressure 1600 psig', 28),
  st('12', 'Commission feed pump & stabilize levels', 6), st('13', 'Flushing oil cut-in & fill reactors', 2),
  st('14', "Catalyst pre-wetting (one reactors' volume) · E-216 commissioning", 8),
  st('15', 'First stage catalyst sulfiding (50% DMDS injected)', 24), st('16', 'Second stage catalyst sulfiding', 24), st('17', 'Black oil cut-in', 2),
];

describe('start-up report (owner, 13 Nov 2026, design A)', () => {
  const r = startupReport(steps, Date.parse(k('2026-11-13T11:05')));
  it('groups 17 steps into 7 stages', () => {
    expect(r.stages.map((s) => s.label)).toEqual(['Preparation', 'Pressurize and test with H2 @ 475 psig (100 psi/h)', 'Commission recycle gas compressor C-201 to operating speed',
      'Heat-up & pressure as per MPT', 'Feed-in & pre-wetting', 'Catalyst sulfiding', 'Black oil cut-in']);
    expect(r.stages[3].sub).toBe('6 steps · 70 h');
    expect(r.stdTotal).toBe(168);
  });
  it('plan is fixed from the first start; done stage carries its actual times and the recorded reasons', () => {
    const p = r.stages[0];
    expect(p.state).toBe('done');
    expect(new Date(p.planEnd! + 3 * 36e5).toISOString().slice(0, 16)).toBe('2026-11-13T06:00');
    expect(p.varH).toBe(2.8);
    expect(p.reasons[0]).toBe('Pull vacuum +1.9 h: Open flang found on EA-201');
    expect(p.reasons).toHaveLength(1); // N2 test 59 min over: under the 1 h threshold
  });
  it('a wait before the next step with no reason says so; the end moves with it', () => {
    expect(r.stages[1].reasons[0]).toMatch(/^Waited 2\.3 h before Pressurize and test with H2: no reason given$/);
    expect(r.varH).toBeCloseTo(5.1, 1);
    expect(r.stages[6].oil).toBe(true);
  });
  it('classes', () => {
    expect(stepClass('C-12-101 start-up and normalization of flow')).toBe('comp');
    expect(stepClass('Increasing pressure to 1000 psig @ 100 psig/h as per MPT')).toBe('heat');
    expect(stepClass('Feed pump preparation')).toBe('feed');
  });
});
