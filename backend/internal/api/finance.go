package api

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type financeOrder struct {
	ID               string `json:"id"`
	WorkspaceID      string `json:"workspaceId"`
	OrderNo          string `json:"orderNo"`
	LeadID           string `json:"leadId"`
	Company          string `json:"company"`
	Currency         string `json:"currency"`
	TotalMinor       int64  `json:"totalMinor"`
	Status           string `json:"status"`
	OrderDate        string `json:"orderDate"`
	DueDate          string `json:"dueDate"`
	Notes            string `json:"notes"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
	PaidMinor        int64  `json:"paidMinor"`
	OutstandingMinor int64  `json:"outstandingMinor"`
	Overdue          bool   `json:"overdue"`
	SettlementStatus string `json:"settlementStatus"`
}
type financePayment struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	OrderID     string `json:"orderId"`
	Currency    string `json:"currency"`
	AmountMinor int64  `json:"amountMinor"`
	PaidAt      string `json:"paidAt"`
	Method      string `json:"method"`
	Reference   string `json:"reference"`
	Notes       string `json:"notes"`
	CreatedAt   string `json:"createdAt"`
}
type financeTotal struct {
	OrderMinor      int64 `json:"orderMinor"`
	PaidMinor       int64 `json:"paidMinor"`
	ReceivableMinor int64 `json:"receivableMinor"`
	OverdueMinor    int64 `json:"overdueMinor"`
	OverdueOrders   int   `json:"overdueOrders"`
}
type financeSnapshot struct {
	Orders           []financeOrder          `json:"orders"`
	Payments         []financePayment        `json:"payments"`
	TotalsByCurrency map[string]financeTotal `json:"totalsByCurrency"`
}

func validFinanceDate(value string) string {
	value = strings.TrimSpace(value)
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil || parsed.Format("2006-01-02") != value {
		return ""
	}
	return value
}

var moneyPattern = regexp.MustCompile(`^\d{1,10}(?:\.\d{1,2})?$`)

func moneyMinor(value any) int64 {
	raw := strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(value)), ",", "")
	if !moneyPattern.MatchString(raw) {
		return 0
	}
	pieces := strings.SplitN(raw, ".", 2)
	whole, _ := strconv.ParseInt(pieces[0], 10, 64)
	minor := whole * 100
	if len(pieces) > 1 {
		fraction := pieces[1]
		if len(fraction) == 1 {
			fraction += "0"
		}
		part, _ := strconv.ParseInt(fraction, 10, 64)
		minor += part
	}
	return minor
}
func financeText(value any, limit int) string {
	if value == nil {
		return ""
	}
	return truncate(strings.TrimSpace(fmt.Sprint(value)), limit)
}

func (s *Server) financeSnapshot(r *http.Request) (financeSnapshot, error) {
	result := financeSnapshot{Orders: []financeOrder{}, Payments: []financePayment{}, TotalsByCurrency: map[string]financeTotal{}}
	orders, err := s.pool.Query(r.Context(), `SELECT o.id,o.workspace_id,o.order_no,o.lead_id,o.company,o.currency,o.total_minor,o.status,o.order_date,o.due_date,o.notes,o.created_at,o.updated_at,COALESCE(p.paid_minor,0)
	FROM orders o LEFT JOIN (SELECT order_id,SUM(amount_minor) AS paid_minor FROM payments WHERE workspace_id=$1 GROUP BY order_id) p ON p.order_id=o.id WHERE o.workspace_id=$1 ORDER BY o.created_at DESC LIMIT 500`, workspaceID)
	if err != nil {
		return result, err
	}
	for orders.Next() {
		var o financeOrder
		err = orders.Scan(&o.ID, &o.WorkspaceID, &o.OrderNo, &o.LeadID, &o.Company, &o.Currency, &o.TotalMinor, &o.Status, &o.OrderDate, &o.DueDate, &o.Notes, &o.CreatedAt, &o.UpdatedAt, &o.PaidMinor)
		if err != nil {
			break
		}
		o.OutstandingMinor = max(0, o.TotalMinor-o.PaidMinor)
		o.Overdue = o.Status != "已取消" && o.OutstandingMinor > 0 && o.DueDate < time.Now().UTC().Format("2006-01-02")
		o.SettlementStatus = "待回款"
		if o.OutstandingMinor == 0 {
			o.SettlementStatus = "已结清"
		} else if o.PaidMinor > 0 {
			o.SettlementStatus = "部分回款"
		}
		result.Orders = append(result.Orders, o)
		if o.Status != "已取消" {
			total := result.TotalsByCurrency[o.Currency]
			total.OrderMinor += o.TotalMinor
			total.PaidMinor += o.PaidMinor
			total.ReceivableMinor += o.OutstandingMinor
			if o.Overdue {
				total.OverdueMinor += o.OutstandingMinor
				total.OverdueOrders++
			}
			result.TotalsByCurrency[o.Currency] = total
		}
	}
	orders.Close()
	if err != nil {
		return result, err
	}
	payments, err := s.pool.Query(r.Context(), `SELECT id,workspace_id,order_id,currency,amount_minor,paid_at,method,reference,notes,created_at FROM payments WHERE workspace_id=$1 ORDER BY paid_at DESC,created_at DESC LIMIT 200`, workspaceID)
	if err != nil {
		return result, err
	}
	for payments.Next() {
		var p financePayment
		err = payments.Scan(&p.ID, &p.WorkspaceID, &p.OrderID, &p.Currency, &p.AmountMinor, &p.PaidAt, &p.Method, &p.Reference, &p.Notes, &p.CreatedAt)
		if err != nil {
			break
		}
		result.Payments = append(result.Payments, p)
	}
	payments.Close()
	return result, err
}
func (s *Server) financeList(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	data, err := s.financeSnapshot(r)
	if err != nil {
		writeError(w, 503, "订单数据不可用")
		return
	}
	writeJSON(w, 200, data)
}

func (s *Server) financeCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input map[string]any
	if decodeJSON(r, &input) != nil {
		writeError(w, 400, "请求格式无效")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	switch financeText(input["type"], 20) {
	case "order":
		leadID := financeText(input["leadId"], 100)
		var company string
		err := s.pool.QueryRow(r.Context(), "SELECT company FROM leads WHERE workspace_id=$1 AND id=$2", workspaceID, leadID).Scan(&company)
		if err != nil {
			writeError(w, 400, "请选择客户库中的客户")
			return
		}
		amount := moneyMinor(input["amount"])
		orderDate := validFinanceDate(financeText(input["orderDate"], 10))
		dueDate := validFinanceDate(financeText(input["dueDate"], 10))
		if amount <= 0 {
			writeError(w, 400, "订单金额无效")
			return
		}
		if orderDate == "" || dueDate == "" || dueDate < orderDate {
			writeError(w, 400, "付款到期日不能早于订单日期")
			return
		}
		currency := financeText(input["currency"], 3)
		if currency != "USD" && currency != "EUR" && currency != "GBP" && currency != "CNY" {
			currency = "USD"
		}
		orderNo := financeText(input["orderNo"], 50)
		if orderNo == "" {
			orderNo = "SO-" + time.Now().UTC().Format("20060102") + "-" + strings.ToUpper(newID()[:6])
		}
		id := newID()
		tx, err := s.pool.Begin(r.Context())
		if err != nil {
			writeError(w, 503, "订单创建失败")
			return
		}
		defer tx.Rollback(r.Context())
		_, err = tx.Exec(r.Context(), `INSERT INTO orders(id,workspace_id,order_no,lead_id,company,currency,total_minor,status,order_date,due_date,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'待确认',$8,$9,$10,$11,$11)`, id, workspaceID, orderNo, leadID, company, currency, amount, orderDate, dueDate, financeText(input["notes"], 1200), now)
		if err != nil {
			writeError(w, 409, "订单号已存在或订单创建失败")
			return
		}
		_, err = tx.Exec(r.Context(), "UPDATE leads SET stage='已成交',updated_at=$1 WHERE workspace_id=$2 AND id=$3", now, workspaceID, leadID)
		if err != nil {
			writeError(w, 503, "订单创建失败")
			return
		}
		if tx.Commit(r.Context()) != nil {
			writeError(w, 503, "订单创建失败")
			return
		}
		s.financeResponse(w, r, id, true, 201)
	case "payment":
		s.createPayment(w, r, input, now)
	default:
		writeError(w, 400, "unsupported type")
	}
}

func (s *Server) createPayment(w http.ResponseWriter, r *http.Request, input map[string]any, now string) {
	orderID := financeText(input["orderId"], 100)
	amount := moneyMinor(input["amount"])
	paidAt := validFinanceDate(financeText(input["paidAt"], 10))
	if amount <= 0 || paidAt == "" {
		writeError(w, 400, "请填写正确的回款金额和到账日期")
		return
	}
	idKey := financeText(input["idempotencyKey"], 80)
	if idKey == "" {
		idKey = newID()
	}
	id := "payment-" + regexp.MustCompile(`[^a-zA-Z0-9-]`).ReplaceAllString(idKey, "")
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 503, "回款登记失败")
		return
	}
	defer tx.Rollback(r.Context())
	var existing string
	err = tx.QueryRow(r.Context(), "SELECT id FROM payments WHERE id=$1", id).Scan(&existing)
	if err == nil {
		_ = tx.Rollback(r.Context())
		s.financeResponse(w, r, id, false, 200)
		return
	}
	var currency, status string
	var totalMinor int64
	err = tx.QueryRow(r.Context(), "SELECT currency,status,total_minor FROM orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE", workspaceID, orderID).Scan(&currency, &status, &totalMinor)
	if err != nil || status == "已取消" {
		writeError(w, 400, "订单不存在或已取消")
		return
	}
	var alreadyPaid int64
	err = tx.QueryRow(r.Context(), "SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE workspace_id=$1 AND order_id=$2", workspaceID, orderID).Scan(&alreadyPaid)
	if err != nil {
		writeError(w, 503, "回款登记失败")
		return
	}
	if amount > totalMinor-alreadyPaid {
		writeError(w, 409, "回款金额不能超过订单剩余应收")
		return
	}
	reference := financeText(input["reference"], 120)
	if reference != "" {
		var duplicate string
		if tx.QueryRow(r.Context(), "SELECT id FROM payments WHERE workspace_id=$1 AND reference=$2 LIMIT 1", workspaceID, reference).Scan(&duplicate) == nil {
			writeError(w, 409, "该银行流水号已经登记")
			return
		}
	}
	method := financeText(input["method"], 30)
	switch method {
	case "银行转账", "信用证", "PayPal", "信用卡":
	default:
		method = "其他"
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO payments(id,workspace_id,order_id,currency,amount_minor,paid_at,method,reference,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, workspaceID, orderID, currency, amount, paidAt, method, reference, financeText(input["notes"], 800), now)
	if err != nil || tx.Commit(r.Context()) != nil {
		writeError(w, 503, "回款登记失败")
		return
	}
	s.financeResponse(w, r, id, true, 201)
}
func (s *Server) financeResponse(w http.ResponseWriter, r *http.Request, id string, created bool, status int) {
	data, err := s.financeSnapshot(r)
	if err != nil {
		writeError(w, 503, "订单数据不可用")
		return
	}
	writeJSON(w, status, map[string]any{"created": created, "id": id, "orders": data.Orders, "payments": data.Payments, "totalsByCurrency": data.TotalsByCurrency})
}

func (s *Server) financeUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireDB(w) {
		return
	}
	var input map[string]any
	if decodeJSON(r, &input) != nil {
		writeError(w, 400, "请求格式无效")
		return
	}
	id := financeText(input["id"], 100)
	var orderDate, status string
	err := s.pool.QueryRow(r.Context(), "SELECT order_date,status FROM orders WHERE workspace_id=$1 AND id=$2", workspaceID, id).Scan(&orderDate, &status)
	if err != nil {
		writeError(w, 404, "订单不存在")
		return
	}
	if proposed, ok := input["status"]; ok {
		status = financeText(proposed, 20)
		switch status {
		case "待确认", "生产中", "已发货", "已完成", "已取消":
		default:
			writeError(w, 400, "订单状态无效")
			return
		}
		if status == "已取消" {
			var count int
			if s.pool.QueryRow(r.Context(), "SELECT count(*) FROM payments WHERE workspace_id=$1 AND order_id=$2", workspaceID, id).Scan(&count) != nil || count > 0 {
				writeError(w, 409, "已有回款的订单不能直接取消")
				return
			}
		}
	}
	var dueDate string
	_ = s.pool.QueryRow(r.Context(), "SELECT due_date FROM orders WHERE workspace_id=$1 AND id=$2", workspaceID, id).Scan(&dueDate)
	if proposed, ok := input["dueDate"]; ok {
		dueDate = validFinanceDate(financeText(proposed, 10))
		if dueDate == "" || dueDate < orderDate {
			writeError(w, 400, "付款到期日无效")
			return
		}
	}
	var notes string
	_ = s.pool.QueryRow(r.Context(), "SELECT notes FROM orders WHERE workspace_id=$1 AND id=$2", workspaceID, id).Scan(&notes)
	if proposed, ok := input["notes"]; ok {
		notes = financeText(proposed, 1200)
	}
	_, err = s.pool.Exec(r.Context(), "UPDATE orders SET status=$1,due_date=$2,notes=$3,updated_at=$4 WHERE workspace_id=$5 AND id=$6", status, dueDate, notes, time.Now().UTC().Format(time.RFC3339), workspaceID, id)
	if err != nil {
		writeError(w, 503, "订单更新失败")
		return
	}
	data, err := s.financeSnapshot(r)
	if err != nil {
		writeError(w, 503, "订单数据不可用")
		return
	}
	writeJSON(w, 200, map[string]any{"updated": true, "orders": data.Orders, "payments": data.Payments, "totalsByCurrency": data.TotalsByCurrency})
}
