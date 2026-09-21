import { ApiError } from "@/server/http/errors";
import { answerBitConnectionRepository } from "@/server/repositories/answerbit-connections";
import { brandRepository } from "@/server/repositories/brands";

export async function loadAnswerBitTeamContext(
  organizationId: string,
  teamBindingId: string,
) {
  const team = await brandRepository.findTeam(organizationId, teamBindingId);
  if (!team)
    throw new ApiError(404, "TEAM_BINDING_NOT_FOUND", "TeamID 不存在或已停用");
  const connection = await answerBitConnectionRepository.findConnection(
    organizationId,
    team.connectionId,
  );
  if (!connection)
    throw new ApiError(
      404,
      "ANSWERBIT_CONNECTION_NOT_FOUND",
      "AnswerBit 连接不存在或已停用",
    );
  return {
    team,
    connection,
    apiKey: { organizationId, teamBindingId },
  };
}
