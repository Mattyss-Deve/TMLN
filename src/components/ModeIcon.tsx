import {
  Bike,
  Car,
  Footprints,
  MapPin,
  Plane,
  TrainFront,
} from 'lucide-react';
import type { TransportMode } from '../types/timeline';

interface ModeIconProps {
  mode: TransportMode;
  className?: string;
}

export function ModeIcon({ mode, className = 'w-3.5 h-3.5' }: ModeIconProps) {
  switch (mode) {
    case 'WALKING':
      return <Footprints className={className} />;
    case 'CYCLING':
      return <Bike className={className} />;
    case 'DRIVING':
      return <Car className={className} />;
    case 'TRANSIT':
      return <TrainFront className={className} />;
    case 'FLYING':
      return <Plane className={className} />;
    case 'STILL':
    default:
      return <MapPin className={className} />;
  }
}
