import { ProjectTypesTab } from './project-types-tab'
import { ProjectsTab } from './projects-tab'
import { StagesSection } from './stages-section'
import { Separator } from '@/components/ui/separator'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

export default function ProjectsPage() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title inline-flex items-center gap-1.5">{t('projects.title')} <ContextualHelp helpId="daily.projects" /></h1>
        <p className="text-sm text-muted-foreground">
          {t('projects.subtitle')}
        </p>
      </div>

      {/* Projects */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('projects.section.projects')}</h2>
        <ProjectsTab />
      </section>

      <Separator className="mb-8" />

      {/* Project Types */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('projects.section.types')}</h2>
        <ProjectTypesTab />
      </section>

      <Separator className="mb-8" />

      {/* Stages */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('projects.section.stages')}</h2>
        <StagesSection />
      </section>
    </div>
  )
}
