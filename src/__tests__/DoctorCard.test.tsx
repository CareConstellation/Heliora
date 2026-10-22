import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DoctorCard from '@/components/doctor/DoctorCard';
import { type Doctor } from '@/types';

const mockDoctor: Doctor = {
  id: 'doc1',
  name: 'Sarah Smith',
  specialty: 'Cardiology',
  address: 'GDOCTOR123',
};

describe('DoctorCard component', () => {
  it('renders doctor details correctly', () => {
    render(<DoctorCard doctor={mockDoctor} />);

    expect(screen.getByText('Sarah Smith')).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
  });

  it('renders as a clickable button when onSelect is provided', () => {
    const handleSelect = jest.fn();
    render(<DoctorCard doctor={mockDoctor} onSelect={handleSelect} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleSelect).toHaveBeenCalledWith(mockDoctor);
  });

  it('renders as static div when onSelect is not provided', () => {
    render(<DoctorCard doctor={mockDoctor} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
