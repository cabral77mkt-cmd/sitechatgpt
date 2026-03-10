# WhatsApp Scheduler (QR + Login)

Aplicação web em Node.js para:

- Login/cadastro por usuário.
- Exibir QR para abrir o WhatsApp Web por usuário.
- Agendar mensagens para **números** ou **grupos/pessoal**.

## Rodar localmente

```bash
npm install
npm start
```

Acesse: `http://localhost:3000`

## Como funciona o agendamento

- Para **número**, quando chegar o horário o sistema gera um link pronto (`wa.me`) com a mensagem preenchida.
- Para **grupo/pessoal**, o sistema prepara abertura do WhatsApp Web com o texto para facilitar o envio.
- O painel mostra o botão **"Abrir envio no WhatsApp"** quando o agendamento fica pronto.

> Observação: navegadores podem bloquear o carregamento do WhatsApp Web em iframe. Nesse caso use o botão/link para abrir em nova aba.

## Segurança

- Troque `SESSION_SECRET` em produção.
- Adicione HTTPS/reverse proxy para ambiente público.
