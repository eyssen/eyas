---
name: backup-recovery
description: Database backup strategies and disaster recovery procedures
trigger_patterns:
  - "database backup"
  - "backup recovery"
  - "disaster recovery"
  - "restore database"
  - "point in time recovery"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: better-sqlite3
    url: https://github.com/WiseLibs/better-sqlite3
    license: MIT
---
# Backup and Recovery

## SQLite Backup
```typescript
// Online backup using the backup API
import Database from 'better-sqlite3';

const db = new Database('app.db');
db.backup('backup.db').then(() => {
  console.log('Backup complete');
});
```

```bash
# SQLite CLI backup
sqlite3 app.db ".backup 'backup.db'"

# With WAL checkpoint first
sqlite3 app.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp app.db backup.db
```

## PostgreSQL Backup

### Logical Backup (pg_dump)
```bash
# Full database dump
pg_dump -Fc -f backup.dump eyas

# Restore
pg_restore -d eyas backup.dump

# Schema only
pg_dump --schema-only -f schema.sql eyas

# Specific tables
pg_dump -t orders -t order_items -Fc -f orders.dump eyas
```

### Physical Backup (pg_basebackup)
```bash
# Full cluster backup for point-in-time recovery
pg_basebackup -D /backup/base -Ft -z -P
```

### Continuous Archiving (WAL)
- Archive WAL segments for point-in-time recovery (PITR)
- Restore to any moment between base backups
- Essential for production databases

## Backup Strategies
| Strategy | RPO | Storage | Complexity |
|----------|-----|---------|------------|
| Full daily | 24h | High | Low |
| Full + incremental | Hours | Medium | Medium |
| Continuous (WAL) | Seconds | Medium | High |
| Replication | Zero | High | High |

## Verification
- Restore backups regularly — untested backups are not backups
- Verify row counts and checksums after restore
- Automate restore testing in CI/CD
- Document restore procedure with step-by-step instructions

## Best Practices
- Follow the 3-2-1 rule: 3 copies, 2 media types, 1 off-site
- Encrypt backups at rest and in transit
- Set retention policies (daily for 7 days, weekly for 4 weeks, monthly for 12 months)
- Monitor backup job success/failure with alerts
- Include backup of application config, secrets, and environment alongside database
- Test full disaster recovery at least quarterly
