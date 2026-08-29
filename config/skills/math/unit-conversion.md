---
name: unit-conversion
description: Unit conversion for length, weight, temperature, data sizes, and more
trigger_patterns:
  - "convert"
  - "unit conversion"
  - "meters to feet"
  - "celsius to fahrenheit"
  - "bytes to megabytes"
capabilities:
  - unit-conversion
  - measurement-systems
  - data-size-conversion
version: "1.0.0"
sources:
  - name: mathjs
    url: https://github.com/josdejong/mathjs
    license: Apache-2.0
---
# Unit Conversion

## Using mathjs
```typescript
import { unit } from 'mathjs';

unit(5, 'km').to('mile').toNumber();       // 3.10686...
unit(100, 'celsius').to('fahrenheit');       // 212 degF
unit(1, 'GB').to('MB').toNumber();          // 1000
unit(1, 'GiB').to('MiB').toNumber();        // 1024
unit(72, 'kg').to('lb').toNumber();          // 158.73...
```

## Common Conversions

### Length
| From | To | Formula |
|------|----|---------|
| km | miles | * 0.621371 |
| m | feet | * 3.28084 |
| cm | inches | * 0.393701 |
| inches | cm | * 2.54 |

### Weight
| From | To | Formula |
|------|----|---------|
| kg | lbs | * 2.20462 |
| lbs | kg | * 0.453592 |
| g | oz | * 0.035274 |

### Temperature
| From | To | Formula |
|------|----|---------|
| Celsius | Fahrenheit | * 9/5 + 32 |
| Fahrenheit | Celsius | (F - 32) * 5/9 |
| Celsius | Kelvin | + 273.15 |

### Data Sizes (SI / Binary)
| Unit | SI (decimal) | Binary (IEC) |
|------|-------------|--------------|
| KB / KiB | 1,000 bytes | 1,024 bytes |
| MB / MiB | 1,000,000 | 1,048,576 |
| GB / GiB | 10^9 | 2^30 |
| TB / TiB | 10^12 | 2^40 |

### Time
| From | To | Value |
|------|----|-------|
| 1 day | hours | 24 |
| 1 day | seconds | 86,400 |
| 1 week | seconds | 604,800 |
| 1 year | days | 365.25 (avg) |

## Programmatic Conversion
```typescript
// Simple converter without library
function convertTemperature(value: number, from: 'C' | 'F' | 'K', to: 'C' | 'F' | 'K'): number {
  // Convert to Celsius first
  let celsius = from === 'C' ? value : from === 'F' ? (value - 32) * 5/9 : value - 273.15;
  // Convert from Celsius to target
  if (to === 'C') return celsius;
  if (to === 'F') return celsius * 9/5 + 32;
  return celsius + 273.15;
}
```

## Tips
- Always specify SI vs. binary for data sizes (GB vs. GiB)
- Use mathjs for complex unit chains: `unit('5 kg * m / s^2')`
- Be explicit about which system you're using (metric vs. imperial)
- Round results to appropriate precision for the context
