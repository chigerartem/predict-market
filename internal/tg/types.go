package tg

// Update is the subset of a Telegram update we handle (Stars payments).
type Update struct {
	UpdateID         int64             `json:"update_id"`
	Message          *Message          `json:"message"`
	PreCheckoutQuery *PreCheckoutQuery `json:"pre_checkout_query"`
}

// Message — only the successful-payment case matters to us here.
type Message struct {
	From              *User              `json:"from"`
	SuccessfulPayment *SuccessfulPayment `json:"successful_payment"`
}

// User is a Telegram user.
type User struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}

// PreCheckoutQuery precedes a payment; the bot must answer it within 10 seconds.
type PreCheckoutQuery struct {
	ID             string `json:"id"`
	From           *User  `json:"from"`
	Currency       string `json:"currency"`
	TotalAmount    int64  `json:"total_amount"`
	InvoicePayload string `json:"invoice_payload"`
}

// SuccessfulPayment confirms a completed payment. For Stars, Currency is "XTR"
// and TotalAmount is the number of stars.
type SuccessfulPayment struct {
	Currency                string `json:"currency"`
	TotalAmount             int64  `json:"total_amount"`
	InvoicePayload          string `json:"invoice_payload"`
	TelegramPaymentChargeID string `json:"telegram_payment_charge_id"`
	ProviderPaymentChargeID string `json:"provider_payment_charge_id"`
}
