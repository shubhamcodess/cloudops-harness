import type { RepoProfile, Requirements, SecretsManifest } from "@smc/contracts";
import { file } from "./util.js";

type Ctx = { app: string; profile: RepoProfile; reqs: Requirements; secrets: SecretsManifest };

const chartYaml = (app: string) => `apiVersion: v2
name: ${app}
description: Helm chart for ${app}
type: application
version: 0.1.0
appVersion: "0.1.0"
`;

const port = (p: RepoProfile): number => p.services.find((s) => s.port)?.port ?? 8080;

const valuesYaml = (ctx: Ctx) => `replicaCount: 2
image:
  repository: ghcr.io/example/${ctx.app}
  tag: "latest"
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
  targetPort: ${port(ctx.profile)}
ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: ${ctx.app}.example.com
      paths:
        - path: /
          pathType: Prefix
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 60
podDisruptionBudget:
  minAvailable: 1
serviceAccount:
  create: true
  name: ""
externalSecrets:
  enabled: true
  storeName: default
  refreshInterval: "1h"
  items:
${ctx.secrets.secrets.map((s) => `    - name: ${s.name}\n      remoteRef: ${ctx.app}/${s.name}`).join("\n")}
networkPolicy:
  enabled: true
  # For AI sandbox workloads: replace this comment with an explicit egress allow-list
  # (e.g. api.openai.com, api.anthropic.com) rather than 0.0.0.0/0.
  egressAllowCidrs:
    - "0.0.0.0/0"
config:
  APP_NAME: ${ctx.app}
`;

const valuesDev = `replicaCount: 1
autoscaling:
  enabled: false
resources:
  requests:
    cpu: 50m
    memory: 64Mi
`;

const valuesProd = `replicaCount: 3
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
`;

const helpersTpl = (app: string) => `{{- define "${app}.name" -}}
${app}
{{- end -}}

{{- define "${app}.fullname" -}}
{{ .Release.Name }}-${app}
{{- end -}}

{{- define "${app}.labels" -}}
app.kubernetes.io/name: ${app}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "${app}.selectorLabels" -}}
app.kubernetes.io/name: ${app}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "${app}.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ default (include "${app}.fullname" .) .Values.serviceAccount.name }}
{{- else -}}
{{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end -}}
`;

const deploymentTpl = (app: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "${app}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${app}.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "${app}.serviceAccountName" . }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: ${app}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          ports:
            - containerPort: {{ .Values.service.targetPort }}
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ include "${app}.fullname" . }}
            {{- if .Values.externalSecrets.enabled }}
            - secretRef:
                name: {{ include "${app}.fullname" . }}
            {{- end }}
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .Values.service.targetPort }}
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .Values.service.targetPort }}
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
`;

const serviceTpl = (app: string) => `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
      name: http
  selector:
    {{- include "${app}.selectorLabels" . | nindent 4 }}
`;

const ingressTpl = (app: string) => `{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "${app}.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
`;

const hpaTpl = (app: string) => `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "${app}.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
`;

const pdbTpl = (app: string) => `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "${app}.selectorLabels" . | nindent 6 }}
`;

const configMapTpl = (app: string) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
data:
  {{- range $k, $v := .Values.config }}
  {{ $k }}: {{ $v | quote }}
  {{- end }}
`;

const saTpl = (app: string) => `{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "${app}.serviceAccountName" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
{{- end }}
`;

const externalSecretTpl = (app: string) => `{{- if .Values.externalSecrets.enabled }}
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ include "${app}.fullname" . }}
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  refreshInterval: {{ .Values.externalSecrets.refreshInterval }}
  secretStoreRef:
    kind: SecretStore
    name: {{ .Values.externalSecrets.storeName }}
  target:
    name: {{ include "${app}.fullname" . }}
    creationPolicy: Owner
  data:
    {{- range .Values.externalSecrets.items }}
    - secretKey: {{ .name }}
      remoteRef:
        key: {{ .remoteRef }}
    {{- end }}
{{- end }}
`;

const networkPolicyTpl = (app: string) => `{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "${app}.fullname" . }}-default-deny
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "${app}.fullname" . }}-allow
  labels:
    {{- include "${app}.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "${app}.selectorLabels" . | nindent 6 }}
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - namespaceSelector: {}
      ports:
        - port: {{ .Values.service.targetPort }}
          protocol: TCP
  egress:
    {{- range .Values.networkPolicy.egressAllowCidrs }}
    - to:
        - ipBlock:
            cidr: {{ . }}
    {{- end }}
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
{{- end }}
`;

const notesTpl = (app: string) => `Chart ${app} installed.
Get the URL:
  kubectl get ingress -l app.kubernetes.io/name=${app}
`;

export const helm = (ctx: Ctx) => {
  const base = `charts/${ctx.app}`;
  const app = ctx.app;
  return [
    file(`${base}/Chart.yaml`, chartYaml(app), "helm"),
    file(`${base}/values.yaml`, valuesYaml(ctx), "helm"),
    file(`${base}/values-dev.yaml`, valuesDev, "helm"),
    file(`${base}/values-prod.yaml`, valuesProd, "helm"),
    file(`${base}/templates/_helpers.tpl`, helpersTpl(app), "helm"),
    file(`${base}/templates/configmap.yaml`, configMapTpl(app), "helm"),
    file(`${base}/templates/deployment.yaml`, deploymentTpl(app), "helm"),
    file(`${base}/templates/externalsecret.yaml`, externalSecretTpl(app), "helm"),
    file(`${base}/templates/hpa.yaml`, hpaTpl(app), "helm"),
    file(`${base}/templates/ingress.yaml`, ingressTpl(app), "helm"),
    file(`${base}/templates/networkpolicy.yaml`, networkPolicyTpl(app), "helm"),
    file(`${base}/templates/pdb.yaml`, pdbTpl(app), "helm"),
    file(`${base}/templates/serviceaccount.yaml`, saTpl(app), "helm"),
    file(`${base}/templates/service.yaml`, serviceTpl(app), "helm"),
    file(`${base}/templates/NOTES.txt`, notesTpl(app), "helm"),
  ];
};
