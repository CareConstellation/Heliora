import { act, fireEvent, render, screen } from '@testing-library/react';
import DiagnosisCodeInput from '@/components/doctor/DiagnosisCodeInput';
import { frequentDiagnoses, searchDiagnoses } from '@/lib/diagnosisSearch';

beforeEach(() => localStorage.clear());

describe('diagnosis code search (#74)', () => {
  it('finds codes by code or description', () => {
    expect(searchDiagnoses('E11.9')[0]).toMatchObject({ code: 'E11.9', system: 'ICD-10-CM' });
    expect(searchDiagnoses('hypertension').map((d) => d.system)).toEqual(
      expect.arrayContaining(['ICD-10-CM', 'SNOMED-CT']),
    );
  });

  it('debounces, selects {code, system, display} and remembers frequent picks', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    render(<DiagnosisCodeInput value={null} onChange={onChange} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'asthma' } });
    expect(screen.queryByRole('option')).toBeNull(); // debounced
    act(() => {
      jest.advanceTimersByTime(200);
    });
    fireEvent.mouseDown(screen.getAllByRole('option')[0]!);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.any(String),
        system: expect.any(String),
        display: expect.any(String),
      }),
    );
    expect(frequentDiagnoses()).toHaveLength(1);
    jest.useRealTimers();
  });
});
