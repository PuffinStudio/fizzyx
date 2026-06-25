export const formatGeneratedOutput = (filesLength: number, outputDir: string): string =>
	`generated ${filesLength} file(s) to ${outputDir}`;

export const formatGeneratedDetails = (endpointsCount: number, typesCount: number): string =>
	`endpoints: ${endpointsCount}  types: ${typesCount}`;

export const formatNoGenerators = (): string => "(no generators available)";

export const formatGeneratorsHeader = (): string => "available generators:";

export const formatGeneratorItem = (name: string, description: string): string =>
	`  ${name}  ${description}`;

export const formatPostGenCommand = (command: string): string => `running: ${command}`;

export const formatGeneratingClientMessage = (): string => "Generating client...";

export const formatOpenApiInitMessage = (): string =>
	"Writing OpenAPI config scaffold to .fizzyx.yaml...";

export const formatOpenApiInitDone = (): string =>
	"OpenAPI config scaffold written to .fizzyx.yaml";

export const formatOpenApiInitSkipped = (): string =>
	`openapi config already exists. Use --force to replace it`;
