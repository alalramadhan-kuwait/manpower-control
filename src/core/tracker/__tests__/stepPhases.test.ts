import { describe, expect, it } from 'vitest';
import { phaseOf, stepPhases } from '..';

// 0 OP to handover · 1 Under maintenance · 2 Under inspection · 3 Under repair · 4 To be boxed up · 5 OP to take back
describe('the stages of every item', () => {
  it('places the OCR steps by their words', () => {
    const cases: [string, number][] = [['Blind', 0], ['Soda ash soaking', 0], ['Entry Permit', 0], ['Remove top basket', 1], ['Dump Catalyst by Double Vacuum', 1], ['Open windows & doors of Johnson screen', 1],
      ['Remove bottom inlet elbow', 1], ['Erect complete internal scaffolding at all thermowells, nozzles & quench', 1], ['Hydro blast cleaning internally for Inspection using 2% Soda Ash solution', 1],
      ['Remove the insulaton for inlet Nozzle', 1], ['Offer for inspection', 2], ['quench pipes Repair if required, Fixing and Leak Test', 3], ['Remove scaffolding', 4], ['Loading of fresh catalyst', 4],
      ['Fix top elbow', 4], ['De-blind', 5]];
    for (const [n, p] of cases) expect([n, phaseOf(n)]).toEqual([n, p]);
  });
  it('other equipment: brackets and weld joints do not mislead; an unplaced step follows the one before', () => {
    expect(phaseOf('Shell pull out(scaffolding modification as required)')).toBe(1);
    expect(phaseOf('Buff clean the components & shell weld joints internally & Measure')).toBe(1);
    expect(phaseOf('Offer RTJ grooves of all open flanges for Visual inspection & LPT.')).toBe(2);
    expect(phaseOf('Remove to Service at Shop')).toBe(1);
    expect(phaseOf('Remove blinds')).toBe(5);
    expect(phaseOf('Install Blinds')).toBe(0);
    expect([...stepPhases([{ id: 'a', activity: 'Offer for Process' }, { id: 'b', activity: 'Collector ring' }, { id: 'c', activity: 'Something new' }]).values()]).toEqual([2, 1, 1]);
  });
});
