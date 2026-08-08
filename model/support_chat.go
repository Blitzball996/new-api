package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// SupportConversation 在线客服会话，每个用户一条
type SupportConversation struct {
	Id            int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId        int    `json:"user_id" gorm:"not null;uniqueIndex"`
	Username      string `json:"username" gorm:"type:varchar(64);index"`
	Subject       string `json:"subject" gorm:"type:varchar(255)"`
	Status        string `json:"status" gorm:"type:varchar(16);default:'open';index"` // open / closed
	LastMessage   string `json:"last_message" gorm:"type:varchar(500)"`
	LastMessageAt int64  `json:"last_message_at" gorm:"bigint;index"`
	UnreadUser    int    `json:"unread_user" gorm:"default:0"`  // 用户未读（客服发的）
	UnreadAdmin   int    `json:"unread_admin" gorm:"default:0"` // 客服未读（用户发的）
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
}

func (SupportConversation) TableName() string {
	return "support_conversations"
}

// SupportMessage 单条客服消息
type SupportMessage struct {
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ConversationId int    `json:"conversation_id" gorm:"not null;index:idx_conv_created"`
	UserId         int    `json:"user_id" gorm:"not null;index"`
	SenderRole     string `json:"sender_role" gorm:"type:varchar(16);not null"` // user / admin
	SenderId       int    `json:"sender_id" gorm:"not null"`
	SenderName     string `json:"sender_name" gorm:"type:varchar(64)"`
	Content        string `json:"content" gorm:"type:text;not null"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint;index:idx_conv_created"`
}

func (SupportMessage) TableName() string {
	return "support_messages"
}

const (
	SupportRoleUser  = "user"
	SupportRoleAdmin = "admin"

	SupportStatusOpen   = "open"
	SupportStatusClosed = "closed"

	// 单条消息上限，挡住把整段日志糊进来的情况
	SupportMaxContentLen = 4000
)

// GetOrCreateConversation 取用户会话，没有就建一条
func GetOrCreateConversation(userId int, username string) (*SupportConversation, error) {
	if userId <= 0 {
		return nil, errors.New("无效的用户")
	}
	var conv SupportConversation
	err := DB.Where("user_id = ?", userId).First(&conv).Error
	if err == nil {
		return &conv, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := time.Now().Unix()
	conv = SupportConversation{
		UserId:    userId,
		Username:  username,
		Status:    SupportStatusOpen,
		CreatedAt: now,
	}
	if err := DB.Create(&conv).Error; err != nil {
		// 并发下可能被另一个请求抢先建好，回查一次
		if qErr := DB.Where("user_id = ?", userId).First(&conv).Error; qErr == nil {
			return &conv, nil
		}
		return nil, err
	}
	return &conv, nil
}

// AddSupportMessage 落一条消息并同步会话摘要与未读数
func AddSupportMessage(conv *SupportConversation, role string, senderId int, senderName, content string) (*SupportMessage, error) {
	if conv == nil || conv.Id == 0 {
		return nil, errors.New("会话不存在")
	}
	if role != SupportRoleUser && role != SupportRoleAdmin {
		return nil, errors.New("无效的发送者身份")
	}
	if content == "" {
		return nil, errors.New("消息内容不能为空")
	}
	if len([]rune(content)) > SupportMaxContentLen {
		return nil, errors.New("消息内容过长")
	}

	now := time.Now().Unix()
	msg := &SupportMessage{
		ConversationId: conv.Id,
		UserId:         conv.UserId,
		SenderRole:     role,
		SenderId:       senderId,
		SenderName:     senderName,
		Content:        content,
		CreatedAt:      now,
	}

	summary := content
	if len([]rune(summary)) > 100 {
		summary = string([]rune(summary)[:100])
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(msg).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"last_message":    summary,
			"last_message_at": now,
			// 用户再开口就重新算进行中，客服关过也重开
			"status": SupportStatusOpen,
		}
		if role == SupportRoleUser {
			updates["unread_admin"] = gorm.Expr("unread_admin + 1")
		} else {
			updates["unread_user"] = gorm.Expr("unread_user + 1")
		}
		return tx.Model(&SupportConversation{}).Where("id = ?", conv.Id).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return msg, nil
}

// GetSupportMessages 拉会话消息，afterId > 0 时只取增量，供轮询使用
func GetSupportMessages(conversationId, afterId, limit int) ([]SupportMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var messages []SupportMessage
	q := DB.Where("conversation_id = ?", conversationId)
	if afterId > 0 {
		q = q.Where("id > ?", afterId)
		err := q.Order("id asc").Limit(limit).Find(&messages).Error
		return messages, err
	}
	// 首次加载取最近 limit 条，再翻回正序
	if err := q.Order("id desc").Limit(limit).Find(&messages).Error; err != nil {
		return nil, err
	}
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, nil
}

// MarkSupportRead 清掉对应角色的未读计数
func MarkSupportRead(conversationId int, role string) error {
	field := "unread_user"
	if role == SupportRoleAdmin {
		field = "unread_admin"
	}
	return DB.Model(&SupportConversation{}).
		Where("id = ?", conversationId).
		Update(field, 0).Error
}

// GetSupportConversationById 按会话 ID 取会话
func GetSupportConversationById(id int) (*SupportConversation, error) {
	var conv SupportConversation
	if err := DB.Where("id = ?", id).First(&conv).Error; err != nil {
		return nil, err
	}
	return &conv, nil
}

// ListSupportConversations 客服端会话列表，按最近活跃排序
func ListSupportConversations(status, keyword string, offset, limit int) ([]SupportConversation, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	q := DB.Model(&SupportConversation{})
	if status == SupportStatusOpen || status == SupportStatusClosed {
		q = q.Where("status = ?", status)
	}
	if keyword != "" {
		q = q.Where("username LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []SupportConversation
	err := q.Order("last_message_at desc, id desc").
		Offset(offset).Limit(limit).Find(&list).Error
	return list, total, err
}

// SetSupportConversationStatus 客服开关会话
func SetSupportConversationStatus(id int, status string) error {
	if status != SupportStatusOpen && status != SupportStatusClosed {
		return errors.New("无效的会话状态")
	}
	return DB.Model(&SupportConversation{}).
		Where("id = ?", id).
		Update("status", status).Error
}

// CountSupportAdminUnread 客服角标：待回复会话数
func CountSupportAdminUnread() (int64, error) {
	var count int64
	err := DB.Model(&SupportConversation{}).
		Where("unread_admin > 0").Count(&count).Error
	return count, err
}
