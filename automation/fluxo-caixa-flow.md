# Fluxo agendado — Fluxo de Caixa

Configure no ambiente DEV, dentro da solução `appbetinhos`:

1. Recorrência diária às 07:00 (America/Sao_Paulo).
2. Chamar sincronização de OPs usando os campos configurados em `cr40f_fluxocaixaconfiguracao`.
3. Consultar lançamentos abertos com data até hoje; enviar e-mail para `cr40f_destinatariosalerta` quando houver atraso ou projeção semanal negativa.
4. Às segundas-feiras, consolidar entradas, saídas e resultado das próximas 26 semanas; enviar resumo por e-mail.
5. Criar `cr40f_fluxocaixaevento` para cada execução, erro e envio.

O Flow usa conexão Office 365 Outlook do ambiente e exige que a lista de destinatários seja preenchida antes de ativação.
