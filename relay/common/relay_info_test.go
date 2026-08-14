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

func TestRelayInfoShouldEstimateUsage(t *testing.T) {
	newStreamInfo := func(received int) *RelayInfo {
		return &RelayInfo{
			IsStream:              true,
			StreamStatus:          NewStreamStatus(),
			ReceivedResponseCount: received,
		}
	}

	t.Run("nil receiver keeps estimating", func(t *testing.T) {
		var info *RelayInfo
		require.True(t, info.ShouldEstimateUsage())
	})

	t.Run("non stream keeps estimating", func(t *testing.T) {
		require.True(t, (&RelayInfo{}).ShouldEstimateUsage())
	})

	t.Run("stream without scanner keeps estimating", func(t *testing.T) {
		// AWS Bedrock 等自行读流的链路没有 StreamStatus，ReceivedResponseCount 不可信
		require.True(t, (&RelayInfo{IsStream: true}).ShouldEstimateUsage())
	})

	t.Run("stream with upstream response estimates", func(t *testing.T) {
		require.True(t, newStreamInfo(3).ShouldEstimateUsage())
	})

	t.Run("client gone before any response skips estimation", func(t *testing.T) {
		info := newStreamInfo(0)
		info.StreamStatus.SetEndReason(StreamEndReasonClientGone, context.Canceled)
		require.False(t, info.ShouldEstimateUsage())
	})

	t.Run("timeout before any response skips estimation", func(t *testing.T) {
		info := newStreamInfo(0)
		info.StreamStatus.SetEndReason(StreamEndReasonTimeout, nil)
		require.False(t, info.ShouldEstimateUsage())
	})
}
