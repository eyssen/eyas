// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Submodule manifest — picked up by the module-loader via the standard
 * submodule discovery pattern. The Prometheus exporter is optional and
 * can be toggled independently of the parent observability module.
 */
export const prometheusExporterManifest = {
  id: 'observability.prometheus',
  name: 'Prometheus Exporter',
  version: '1.0.0',
  type: 'core' as const,
  required: false,
  description: 'Exposes EYAS runtime metrics in Prometheus text format on /metrics',
  dependencies: ['observability'],
  optional: ['agent', 'model', 'scheduler'],
}
