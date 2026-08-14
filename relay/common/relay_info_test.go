package common

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestRelayInfoGetFinalRequestRelayFormatPrefersExplicitFinal(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		RequestConversionChain:  []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
		FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatOpenAIResponses), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToConversionChain(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:            types.RelayFormatOpenAI,
		RequestConversionChain: []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatClaude), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToRelayFormat(t *testing.T) {
	info := &RelayInfo{
		RelayFormat: types.RelayFormatGemini,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatGemini), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatNilReceiver(t *testing.T) {
	var info *RelayInfo
	require.Equal(t, types.RelayFormat(""), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoIsStreamAbortedWithoutResponse(t *testing.T) {
	newStreamInfo := func(received int) *RelayInfo {
		return &RelayInfo{
			IsStream:              true,
			StreamStatus:          NewStreamStatus(),
			ReceivedResponseCount: received,
		}
	}

	t.Run("nil receiver", func(t *testing.T) {
		var info *RelayInfo
		require.False(t, info.IsStreamAbortedWithoutResponse())
	})

	t.Run("non stream", func(t *testing.T) {
		require.False(t, (&RelayInfo{}).IsStreamAbortedWithoutResponse())
	})

	t.Run("stream without scanner", func(t *testing.T) {
		// AWS Bedrock 等自行读流的链路没有 StreamStatus，ReceivedResponseCount 不可信
		require.False(t, (&RelayInfo{IsStream: true}).IsStreamAbortedWithoutResponse())
	})

	t.Run("stream with upstream response", func(t *testing.T) {
		require.False(t, newStreamInfo(3).IsStreamAbortedWithoutResponse())
	})

	t.Run("client gone before any response", func(t *testing.T) {
		info := newStreamInfo(0)
		info.StreamStatus.SetEndReason(StreamEndReasonClientGone, context.Canceled)
		require.True(t, info.IsStreamAbortedWithoutResponse())
	})

	t.Run("timeout before any response", func(t *testing.T) {
		info := newStreamInfo(0)
		info.StreamStatus.SetEndReason(StreamEndReasonTimeout, nil)
		require.True(t, info.IsStreamAbortedWithoutResponse())
	})
}

func TestRelayInfoGetBillableEstimatePromptTokens(t *testing.T) {
	t.Run("nil receiver", func(t *testing.T) {
		var info *RelayInfo
		require.Equal(t, 0, info.GetBillableEstimatePromptTokens())
	})

	t.Run("non stream keeps full estimate", func(t *testing.T) {
		info := &RelayInfo{}
		info.SetEstimatePromptTokens(50000)
		require.Equal(t, 50000, info.GetBillableEstimatePromptTokens())
	})

	t.Run("stream with response keeps full estimate", func(t *testing.T) {
		info := &RelayInfo{IsStream: true, StreamStatus: NewStreamStatus(), ReceivedResponseCount: 1}
		info.SetEstimatePromptTokens(50000)
		require.Equal(t, 50000, info.GetBillableEstimatePromptTokens())
	})

	t.Run("aborted without response applies discount", func(t *testing.T) {
		info := &RelayInfo{IsStream: true, StreamStatus: NewStreamStatus()}
		info.StreamStatus.SetEndReason(StreamEndReasonClientGone, context.Canceled)
		info.SetEstimatePromptTokens(50000)
		// 默认比例 0.5
		require.Equal(t, 25000, info.GetBillableEstimatePromptTokens())
	})

	t.Run("zero estimate stays zero", func(t *testing.T) {
		info := &RelayInfo{IsStream: true, StreamStatus: NewStreamStatus()}
		info.StreamStatus.SetEndReason(StreamEndReasonClientGone, context.Canceled)
		require.Equal(t, 0, info.GetBillableEstimatePromptTokens())
	})

	t.Run("discount never rounds down to zero", func(t *testing.T) {
		info := &RelayInfo{IsStream: true, StreamStatus: NewStreamStatus()}
		info.StreamStatus.SetEndReason(StreamEndReasonClientGone, context.Canceled)
		info.SetEstimatePromptTokens(1)
		require.Equal(t, 1, info.GetBillableEstimatePromptTokens())
	})
}
