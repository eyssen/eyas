{{/*
Expand the name of the chart.
*/}}
{{- define "eyas.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name (default: release + chart name).
*/}}
{{- define "eyas.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart label value (name-version).
*/}}
{{- define "eyas.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels applied to every resource.
*/}}
{{- define "eyas.labels" -}}
helm.sh/chart: {{ include "eyas.chart" . }}
{{ include "eyas.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: eyas
{{- end -}}

{{/*
Selector labels (used to match pods via Service/Deployment selectors).
These must be stable — never include version/chart keys here.
*/}}
{{- define "eyas.selectorLabels" -}}
app.kubernetes.io/name: {{ include "eyas.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
ServiceAccount name.
*/}}
{{- define "eyas.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "eyas.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Data PVC claim name (supports existingClaim).
*/}}
{{- define "eyas.dataClaimName" -}}
{{- if .Values.persistence.data.existingClaim -}}
{{- .Values.persistence.data.existingClaim -}}
{{- else -}}
{{- printf "%s-data" (include "eyas.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Logs PVC claim name.
*/}}
{{- define "eyas.logsClaimName" -}}
{{- if .Values.persistence.logs.existingClaim -}}
{{- .Values.persistence.logs.existingClaim -}}
{{- else -}}
{{- printf "%s-logs" (include "eyas.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Inline Secret name (used when secret.create is true).
*/}}
{{- define "eyas.inlineSecretName" -}}
{{- default (printf "%s-secret" (include "eyas.fullname" .)) .Values.secret.name -}}
{{- end -}}

{{/*
Target namespace. Honors values.namespace.name, falling back to Release.Namespace.
*/}}
{{- define "eyas.namespace" -}}
{{- default .Release.Namespace .Values.namespace.name -}}
{{- end -}}

{{/*
Image reference (repository:tag).
*/}}
{{- define "eyas.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}
